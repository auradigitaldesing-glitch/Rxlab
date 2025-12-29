// Vercel Serverless Function para Brevo API
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

    // Obtener API key de variables de entorno
    const BREVO_API_KEY = process.env.BREVO_API_KEY;

    if (!BREVO_API_KEY) {
      console.error('❌ BREVO_API_KEY no está configurada en las variables de entorno');
      return res.status(500).json({ error: 'Error de configuración del servidor' });
    }

    // ID de lista fijo: 2
    const BREVO_LIST_ID = 2;

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
      console.error('❌ Brevo devolvió respuesta no-JSON:', responseText);
      return res.status(500).json({
        error: `Error de comunicación con Brevo (status: ${brevoResponse.status})`
      });
    }

    // Si hay error, verificar si es por contacto duplicado (esto se considera éxito con updateEnabled: true)
    if (!brevoResponse.ok) {
      if (brevoResponse.status === 400 && 
          (brevoResult.code === 'duplicate_parameter' || 
           brevoResult.message?.toLowerCase().includes('duplicate'))) {
        // Contacto duplicado pero se actualizará (éxito)
        return res.status(200).json({ 
          success: true, 
          message: 'Contacto actualizado exitosamente',
          data: { email, name, phone, company, message }
        });
      }

      // Otros errores
      console.error('❌ Error de Brevo API:', {
        status: brevoResponse.status,
        message: brevoResult.message || 'Error desconocido',
        code: brevoResult.code
      });

      return res.status(500).json({ 
        error: brevoResult.message || 'Error al procesar la solicitud con Brevo' 
      });
    }

    // Éxito
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

