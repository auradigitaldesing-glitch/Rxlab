// Vercel Serverless Function para Brevo API
// Esta función recibe datos del formulario y los envía a Brevo CRM

export default async function handler(req, res) {
  // Solo permitir métodos POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    // Obtener y sanitizar datos del body
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const phone = (req.body.phone || '').trim();
    const company = (req.body.company || '').trim();
    const message = (req.body.message || '').trim();

    // Validaciones básicas
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

    // Validar teléfono si se proporciona
    if (phone && phone.length < 7) {
      return res.status(400).json({ error: 'El teléfono debe tener al menos 7 caracteres' });
    }

    // Obtener variables de entorno
    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    const BREVO_LIST_ID = parseInt(process.env.BREVO_LIST_ID) || 2;

    // Validar que la API key esté configurada
    if (!BREVO_API_KEY) {
      console.error('❌ BREVO_API_KEY no está configurada en las variables de entorno');
      return res.status(500).json({ error: 'Error de configuración del servidor' });
    }

    // Log seguro (sin mostrar la API key completa)
    console.log('📥 Datos recibidos:', {
      name: name.substring(0, 20) + '...',
      email,
      phone: phone ? phone.substring(0, 5) + '***' : 'no proporcionado',
      company: company || 'no proporcionado',
      listId: BREVO_LIST_ID,
      apiKeyConfigured: BREVO_API_KEY ? '✅' : '❌'
    });

    // Preparar datos para Brevo
    const contactData = {
      email: email,
      attributes: {
        FIRSTNAME: name.split(' ')[0] || name,
        LASTNAME: name.split(' ').slice(1).join(' ') || ''
      },
      listIds: [BREVO_LIST_ID],
      updateEnabled: true
    };

    // Agregar teléfono si existe (formato E.164: debe empezar con +)
    if (phone) {
      const phoneFormatted = phone.startsWith('+') ? phone : `+${phone}`;
      contactData.attributes.SMS = phoneFormatted;
      console.log('📱 Teléfono formateado:', phoneFormatted.substring(0, 6) + '***');
    }

    // Agregar empresa si existe
    if (company) {
      contactData.attributes.COMPANY = company;
    }

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

    if (contentType && contentType.includes('application/json')) {
      try {
        brevoResult = JSON.parse(responseText);
      } catch (parseError) {
        console.error('❌ Error al parsear JSON de Brevo:', parseError);
        return res.status(500).json({ error: 'Error al procesar respuesta de Brevo' });
      }
    } else {
      console.error('❌ Brevo devolvió respuesta no-JSON:', responseText.substring(0, 200));
      return res.status(500).json({
        error: `Error de comunicación con Brevo (status: ${brevoResponse.status})`
      });
    }

    // Si hay error, verificar el tipo
    if (!brevoResponse.ok) {
      const errorMessage = brevoResult.message || 'Error desconocido';
      const errorCode = brevoResult.code;

      console.error('❌ Error de Brevo API:', {
        status: brevoResponse.status,
        code: errorCode,
        message: errorMessage
      });

      // Si es un error de contacto duplicado (email o teléfono), intentar actualizar
      if (brevoResponse.status === 400) {
        // Caso 1: Email duplicado - con updateEnabled: true debería actualizarse, pero verificamos
        if (errorCode === 'duplicate_parameter' || errorMessage.toLowerCase().includes('duplicate')) {
          // Intentar actualizar el contacto existente usando PUT
          console.log('🔄 Contacto duplicado detectado, intentando actualizar...');
          
          try {
            const updateResponse = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
              method: 'PUT',
              headers: {
                'accept': 'application/json',
                'api-key': BREVO_API_KEY,
                'content-type': 'application/json'
              },
              body: JSON.stringify(contactData)
            });

            if (updateResponse.ok) {
              const updateResult = await updateResponse.json();
              console.log('✅ Contacto actualizado exitosamente');
              return res.status(200).json({
                success: true,
                message: 'Contacto actualizado exitosamente',
                data: { email, name, phone, company, message }
              });
            } else {
              const updateErrorText = await updateResponse.text();
              console.error('❌ Error al actualizar contacto:', updateResponse.status, updateErrorText.substring(0, 200));
              // Continuar con el error original
            }
          } catch (updateError) {
            console.error('❌ Error al intentar actualizar:', updateError);
            // Continuar con el error original
          }
        }

        // Caso 2: Teléfono (SMS) ya asociado a otro contacto
        if (errorMessage.includes('SMS') || errorMessage.includes('phone') || errorMessage.includes('teléfono')) {
          console.log('⚠️ Teléfono ya está asociado a otro contacto. Intentando sin teléfono...');
          
          // Crear/actualizar contacto sin el atributo SMS
          const contactDataWithoutPhone = {
            email: email,
            attributes: {
              FIRSTNAME: name.split(' ')[0] || name,
              LASTNAME: name.split(' ').slice(1).join(' ') || ''
            },
            listIds: [BREVO_LIST_ID],
            updateEnabled: true
          };

          if (company) {
            contactDataWithoutPhone.attributes.COMPANY = company;
          }

          try {
            const retryResponse = await fetch('https://api.brevo.com/v3/contacts', {
              method: 'POST',
              headers: {
                'accept': 'application/json',
                'api-key': BREVO_API_KEY,
                'content-type': 'application/json'
              },
              body: JSON.stringify(contactDataWithoutPhone)
            });

            if (retryResponse.ok) {
              console.log('✅ Contacto creado/actualizado sin teléfono');
              // Aún retornamos éxito, el teléfono se guardará en otro lado si es necesario
              return res.status(200).json({
                success: true,
                message: 'Contacto creado exitosamente (teléfono no pudo ser asociado)',
                data: { email, name, phone, company, message }
              });
            } else {
              const retryErrorText = await retryResponse.text();
              console.error('❌ Error al reintentar sin teléfono:', retryResponse.status, retryErrorText.substring(0, 200));
            }
          } catch (retryError) {
            console.error('❌ Error al reintentar:', retryError);
          }
        }
      }

      // Si llegamos aquí, hubo un error que no pudimos manejar
      return res.status(500).json({
        error: errorMessage || 'Error al procesar la solicitud con Brevo'
      });
    }

    // Éxito - contacto creado
    console.log('✅ Contacto creado exitosamente en Brevo');
    return res.status(200).json({
      success: true,
      message: 'Contacto creado exitosamente',
      data: { email, name, phone, company, message }
    });

  } catch (error) {
    console.error('❌ Error en handler:', error);
    return res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
}
