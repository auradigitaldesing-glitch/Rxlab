const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting: 30 requests por 15 minutos por IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 30, // máximo 30 requests
  message: { error: 'Demasiadas solicitudes. Por favor intenta más tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Servir archivos estáticos
app.use(express.static(path.join(__dirname)));

// Endpoint para Brevo
app.post('/api/brevo', limiter, async (req, res) => {
  try {
    // Log de los datos recibidos para debugging
    console.log('📥 Datos recibidos:', JSON.stringify(req.body, null, 2));

    // Obtener y sanitizar datos
    const name = (req.body.name || req.body.Nombre || '').trim();
    const company = (req.body.company || req.body.Empresa || '').trim();
    const email = (req.body.email || req.body.Email || '').trim().toLowerCase();
    const phone = (req.body.phone || req.body.Telefono || '').trim();
    const message = (req.body.message || req.body.Mensaje || '').trim();

    // Debug: ver qué datos se recibieron
    console.log('📥 Datos recibidos en el servidor:');
    console.log('  Nombre:', name);
    console.log('  Email:', email);
    console.log('  Teléfono recibido:', phone);
    console.log('  Empresa:', company);
    console.log('  Mensaje:', message.substring(0, 50) + '...');

    // Validaciones
    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'El nombre es requerido y debe tener al menos 2 caracteres' });
    }

    if (!email) {
      return res.status(400).json({ error: 'El email es requerido' });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'El formato del email no es válido' });
    }

    if (!message || message.length < 10) {
      return res.status(400).json({ error: 'El mensaje es requerido y debe tener al menos 10 caracteres' });
    }

    // Obtener API key de variables de entorno
    const BREVO_API_KEY = process.env.BREVO_API_KEY;

    if (!BREVO_API_KEY) {
      console.error('❌ BREVO_API_KEY no está configurada en las variables de entorno');
      return res.status(500).json({ error: 'Error de configuración del servidor' });
    }

    // Obtener ID de lista desde variables de entorno (por defecto 4)
    const BREVO_LIST_ID = parseInt(process.env.BREVO_LIST_ID) || 4;

    // Preparar datos para Brevo con atributos correctos
    // Mapeo: NOMBRE = primera palabra, APELLIDOS = resto
    const nameParts = name.split(' ');
    const NOMBRE = nameParts[0] || name;
    const APELLIDOS = nameParts.slice(1).join(' ') || '';

    const contactData = {
      email: email,
      attributes: {
        NOMBRE: NOMBRE,
        APELLIDOS: APELLIDOS
      },
      listIds: [BREVO_LIST_ID],
      updateEnabled: true
    };

    // Agregar empresa si existe (atributo: EMPRESA)
    if (company) {
      contactData.attributes.EMPRESA = company;
      console.log('🏢 Empresa agregada a Brevo:', company);
    } else {
      console.log('⚠️ No se proporcionó empresa');
    }

    // Agregar teléfono solo si existe (formato E.164: debe empezar con +)
    // Brevo usa SMS como atributo estándar para teléfono
    if (phone) {
      // Asegurar que el teléfono tenga formato internacional
      const phoneFormatted = phone.startsWith('+') ? phone : `+${phone}`;
      contactData.attributes.SMS = phoneFormatted;
      console.log('📱 Teléfono formateado para Brevo:', phoneFormatted);
    } else {
      console.log('⚠️ No se recibió teléfono en la petición');
    }

    // Log de datos que se enviarán a Brevo
    console.log('📤 Enviando a Brevo:', JSON.stringify(contactData, null, 2));

    // Enviar a Brevo API
    const brevoResponse = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify(contactData)
    });

    // Manejar respuesta de Brevo
    let brevoResult;
    const contentType = brevoResponse.headers.get('content-type');
    const responseText = await brevoResponse.text();
    
    console.log(`📨 Respuesta de Brevo - Status: ${brevoResponse.status}, Content-Type: ${contentType}`);
    console.log(`📨 Respuesta completa: ${responseText.substring(0, 500)}`);
    
    if (contentType && contentType.includes('application/json')) {
      try {
        brevoResult = JSON.parse(responseText);
      } catch (parseError) {
        console.error('❌ Error al parsear JSON de Brevo:', parseError);
        return res.status(500).json({ 
          error: 'Error al procesar respuesta de Brevo' 
        });
      }
    } else {
      console.error('❌ Brevo devolvió respuesta no-JSON:', responseText);
      return res.status(500).json({ 
        error: `Error de comunicación con Brevo (status: ${brevoResponse.status})`,
        details: responseText.substring(0, 200)
      });
    }

    if (!brevoResponse.ok) {
      // Log error completo para debugging
      console.error('❌ Error de Brevo API:', {
        status: brevoResponse.status,
        statusText: brevoResponse.statusText,
        message: brevoResult.message || 'Error desconocido',
        code: brevoResult.code,
        details: brevoResult
      });

      // Si el contacto ya existe pero el SMS está asociado a otro contacto, intentar sin SMS
      if (brevoResponse.status === 400 && brevoResult.message?.includes('SMS is already associated with another Contact')) {
        console.log('⚠️ El teléfono ya está asociado a otro contacto. Intentando crear/actualizar sin teléfono...');
        
        // Crear contacto sin SMS
        const contactDataWithoutPhone = {
          email: email,
          attributes: {
            NOMBRE: NOMBRE,
            APELLIDOS: APELLIDOS
          },
          listIds: [BREVO_LIST_ID],
          updateEnabled: true
        };

        // Agregar empresa si existe
        if (company) {
          contactDataWithoutPhone.attributes.EMPRESA = company;
        }

        const brevoResponseRetry = await fetch('https://api.brevo.com/v3/contacts', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': BREVO_API_KEY,
            'content-type': 'application/json'
          },
          body: JSON.stringify(contactDataWithoutPhone)
        });

        if (brevoResponseRetry.ok) {
          const brevoResultRetry = await brevoResponseRetry.json();
          console.log('✅ Contacto creado/actualizado sin teléfono:', brevoResultRetry.id || 'contacto actualizado');
          // Continuar para enviar el email de notificación
        } else {
          const brevoResultRetryText = await brevoResponseRetry.text();
          console.error('❌ Error al intentar sin teléfono:', brevoResultRetryText);
          // Continuar de todos modos para enviar el email de notificación
        }
      } 
      // Si el contacto ya existe (duplicate email), considerarlo éxito
      else if (brevoResponse.status === 400 && (brevoResult.code === 'duplicate_parameter' || brevoResult.message?.toLowerCase().includes('duplicate'))) {
        console.log('ℹ️ Contacto ya existe, se actualizará. Continuando...');
        // Continuar para enviar el email de notificación
      } else {
        // Log detallado del error
        console.error('❌ Error completo de Brevo:', JSON.stringify(brevoResult, null, 2));
        
        // Pasar el mensaje de error específico al frontend (sin exponer detalles sensibles)
        let errorMessage = 'Error al procesar la solicitud';
        
        if (brevoResponse.status === 401) {
          errorMessage = 'API Key inválida o expirada';
        } else if (brevoResponse.status === 404) {
          errorMessage = 'Recurso no encontrado (verifica el ID de lista)';
        } else if (brevoResponse.status === 400) {
          // Intentar dar un mensaje más útil
          if (brevoResult.message) {
            errorMessage = brevoResult.message;
          } else if (brevoResult.code === 'invalid_parameter') {
            errorMessage = 'Algunos datos no son válidos (verifica el formato del teléfono)';
          } else {
            errorMessage = 'Datos inválidos';
          }
        } else if (brevoResult.message) {
          errorMessage = brevoResult.message;
        }

        return res.status(500).json({ 
          error: errorMessage 
        });
      }
    } else {
      console.log('✅ Contacto creado/actualizado en Brevo:', brevoResult.id || 'contacto actualizado');
    }

    // Éxito - enviar email de notificación usando Brevo Transactional API
    try {
      const emailResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': BREVO_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: {
            name: 'RXLab Landing',
            email: 'noreply@rxlab.com' // Cambia por tu email verificado en Brevo
          },
          to: [{
            email: 'atapiarubio487@gmail.com', // Tu email de destino
            name: 'RXLab'
          }],
          subject: 'Nuevo lead desde Landing RXLab',
          htmlContent: `
            <h2>Nuevo contacto desde el formulario</h2>
            <p><strong>Nombre:</strong> ${name}</p>
            <p><strong>Empresa:</strong> ${company || 'No proporcionada'}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Teléfono:</strong> ${phone || 'No proporcionado'}</p>
            <p><strong>Mensaje:</strong></p>
            <p>${message.replace(/\n/g, '<br>')}</p>
          `,
          textContent: `
            Nuevo contacto desde el formulario
            
            Nombre: ${name}
            Empresa: ${company || 'No proporcionada'}
            Email: ${email}
            Teléfono: ${phone || 'No proporcionado'}
            Mensaje: ${message}
          `
        })
      });

      if (emailResponse.ok) {
        console.log('✅ Email de notificación enviado correctamente');
      } else {
        const emailErrorText = await emailResponse.text();
        console.warn('⚠️ No se pudo enviar email de notificación:', emailResponse.status, emailErrorText);
      }
    } catch (emailError) {
      // No fallar si el email no se puede enviar
      console.warn('⚠️ Error al enviar email de notificación:', emailError.message);
    }

    // Éxito
    console.log('✅ Contacto procesado correctamente:', { email, name, company, phone });
    res.status(200).json({ 
      success: true, 
      message: 'Mensaje enviado correctamente',
      id: brevoResult.id || 'contacto actualizado'
    });

  } catch (error) {
    // Log error completo para debugging
    console.error('Error en el servidor:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      error: 'Error interno del servidor. Por favor intenta más tarde.' 
    });
  }
});

// Ruta raíz - servir index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📧 Endpoint Brevo: http://localhost:${PORT}/api/brevo`);
  
  if (!process.env.BREVO_API_KEY) {
    console.warn('⚠️  ADVERTENCIA: BREVO_API_KEY no está configurada. Crea un archivo .env con tu API key.');
  }
});

