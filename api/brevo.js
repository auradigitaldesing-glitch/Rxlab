// Vercel Serverless Function para Brevo API
// Esta función recibe datos del formulario y los envía a Brevo CRM

// Función auxiliar para manejar respuesta de Brevo
async function handleBrevoResponse(response, email, name, phone, company, message) {
  console.log(`📨 Respuesta de Brevo - Status: ${response.status}`);

  // Si Brevo responde 204 (No Content), es éxito - no hay body que leer
  if (response.status === 204) {
    console.log('✅ Brevo respondió 204 (No Content) → ÉXITO');
    return {
      ok: true,
      status: 204,
      success: true,
      message: 'Contacto creado o actualizado correctamente en Brevo'
    };
  }

  // Si status es 200 o 201, leer JSON normalmente
  if (response.status === 200 || response.status === 201) {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        const responseText = await response.text();
        if (responseText) {
          const result = JSON.parse(responseText);
          console.log('✅ Brevo respondió con JSON → ÉXITO');
          return {
            ok: true,
            success: true,
            message: 'Contacto creado exitosamente'
          };
        }
      } catch (parseError) {
        console.error('❌ Error al parsear JSON de Brevo:', parseError);
        // Aún así es éxito si el status es 200/201
        return {
          ok: true,
          success: true,
          message: 'Contacto procesado correctamente en Brevo'
        };
      }
    } else {
      // Status 200/201 pero sin JSON también es éxito
      console.log('✅ Brevo respondió con status 200/201 (sin JSON) → ÉXITO');
      return {
        ok: true,
        success: true,
        message: 'Contacto creado exitosamente'
      };
    }
  }

  // Si hay error, intentar leer JSON del error
  const contentType = response.headers.get('content-type');
  let errorResult = null;
  
  if (contentType && contentType.includes('application/json')) {
    try {
      const responseText = await response.text();
      if (responseText) {
        errorResult = JSON.parse(responseText);
      }
    } catch (parseError) {
      console.error('❌ Error al parsear JSON de error de Brevo:', parseError);
      return {
        ok: false,
        status: response.status,
        code: null,
        message: 'Error al procesar respuesta de Brevo'
      };
    }
  }

  return {
    ok: false,
    status: response.status,
    code: errorResult?.code || null,
    message: errorResult?.message || 'Error desconocido',
    errorResult
  };
}

export default async function handler(req, res) {
  // Solo permitir métodos POST
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  try {
    // Log del body completo recibido (para debug)
    console.log('📥 Body recibido:', JSON.stringify(req.body));

    // Obtener y sanitizar datos del body
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const phone = (req.body.phone || '').trim();
    const company = (req.body.company || '').trim();
    const message = (req.body.message || '').trim();

    // Log de datos parseados (seguro, sin exponer datos completos)
    console.log('📋 Datos parseados:', {
      name: name ? `${name.substring(0, 15)}... (${name.length} chars)` : 'VACÍO',
      email: email || 'VACÍO',
      phone: phone ? `${phone.substring(0, 6)}*** (${phone.length} chars)` : 'VACÍO',
      company: company ? `${company.substring(0, 15)}...` : 'VACÍO',
      message: message ? `${message.substring(0, 20)}... (${message.length} chars)` : 'VACÍO'
    });

    // Validaciones básicas
    if (!name || name.length < 2) {
      console.error('❌ Validación fallida: nombre inválido');
      return res.status(400).json({ ok: false, error: 'El nombre es requerido y debe tener al menos 2 caracteres' });
    }

    if (!email) {
      console.error('❌ Validación fallida: email vacío');
      return res.status(400).json({ ok: false, error: 'El email es requerido' });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error('❌ Validación fallida: formato de email inválido');
      return res.status(400).json({ ok: false, error: 'El formato del email no es válido' });
    }

    // Validar teléfono si se proporciona
    if (phone && phone.length < 7) {
      console.error('❌ Validación fallida: teléfono muy corto');
      return res.status(400).json({ ok: false, error: 'El teléfono debe tener al menos 7 caracteres' });
    }

    // Obtener variables de entorno
    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    const BREVO_LIST_ID = parseInt(process.env.BREVO_LIST_ID) || 2;

    // Validar que la API key esté configurada
    if (!BREVO_API_KEY) {
      console.error('❌ BREVO_API_KEY no está configurada en las variables de entorno');
      return res.status(500).json({ ok: false, error: 'Error de configuración del servidor' });
    }

    // Preparar datos para Brevo con atributos reales
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
    }

    // Agregar teléfono si existe (formato E.164: debe empezar con +)
    let phoneFormatted = null;
    if (phone) {
      phoneFormatted = phone.startsWith('+') ? phone : `+${phone}`;
      contactData.attributes.SMS = phoneFormatted;
      console.log('📱 Teléfono agregado a Brevo (SMS):', phoneFormatted.substring(0, 6) + '***');
    } else {
      console.log('⚠️ No se proporcionó teléfono');
    }

    // Log del payload que se enviará a Brevo (solo keys de atributos)
    console.log('📤 Payload final enviado a Brevo:', {
      email: contactData.email,
      attributes: Object.keys(contactData.attributes),
      listIds: contactData.listIds
    });

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
    const brevoResult = await handleBrevoResponse(brevoResponse, email, name, phone, company, message);

    // Si es éxito, retornar inmediatamente
    if (brevoResult.ok) {
      return res.status(200).json({
        ...brevoResult,
        data: { email, name, phone, company, message }
      });
    }

    // Si hay error, verificar el tipo
    const errorMessage = brevoResult.message || 'Error desconocido';
    const errorCode = brevoResult.code;

    console.error('❌ Error de Brevo API:', {
      status: brevoResponse.status,
      code: errorCode,
      message: errorMessage
    });

    // Si es un error de contacto duplicado (email o teléfono), intentar actualizar
    if (brevoResponse.status === 400) {
      // Caso 1: Email duplicado - intentar actualizar con PUT
      if (errorCode === 'duplicate_parameter' && 
          (errorMessage.toLowerCase().includes('email') || 
           (errorMessage.toLowerCase().includes('contact') && !errorMessage.toLowerCase().includes('sms')))) {
        console.log('🔄 Contacto duplicado detectado (email), intentando actualizar...');
        
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

          const updateResult = await handleBrevoResponse(updateResponse, email, name, phone, company, message);
          
          if (updateResult.ok) {
            return res.status(200).json({
              ...updateResult,
              data: { email, name, phone, company, message }
            });
          } else {
            console.error('❌ Error al actualizar contacto:', updateResponse.status);
            // Continuar con el error original
          }
        } catch (updateError) {
          console.error('❌ Error al intentar actualizar:', updateError);
          // Continuar con el error original
        }
      }

      // Caso 2: Teléfono (SMS) duplicado - guardar en PHONE_BACKUP
      const isSMSDuplicate = errorCode === 'duplicate_parameter' && 
                             (errorMessage.includes('SMS') || 
                              errorMessage.includes('phone') || 
                              errorMessage.includes('teléfono') ||
                              errorMessage.includes('mobile'));
      
      if (isSMSDuplicate && phoneFormatted) {
        console.log('⚠️ SMS duplicado, teléfono guardado como PHONE_BACKUP');
        
        // Crear contacto sin SMS pero con PHONE_BACKUP
        const contactDataWithBackup = {
          email: email,
          attributes: {
            NOMBRE: NOMBRE,
            APELLIDOS: APELLIDOS,
            PHONE_BACKUP: phoneFormatted
          },
          listIds: [BREVO_LIST_ID],
          updateEnabled: true
        };

        // Agregar empresa si existe
        if (company) {
          contactDataWithBackup.attributes.EMPRESA = company;
        }

        console.log('📤 Payload con PHONE_BACKUP:', {
          email: contactDataWithBackup.email,
          attributes: Object.keys(contactDataWithBackup.attributes),
          listIds: contactDataWithBackup.listIds
        });

        try {
          // Intentar crear contacto con PHONE_BACKUP
          const retryResponse = await fetch('https://api.brevo.com/v3/contacts', {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'api-key': BREVO_API_KEY,
              'content-type': 'application/json'
            },
            body: JSON.stringify(contactDataWithBackup)
          });

          const retryResult = await handleBrevoResponse(retryResponse, email, name, phone, company, message);
          
          if (retryResult.ok) {
            return res.status(200).json({
              ...retryResult,
              message: 'Contacto creado exitosamente (teléfono guardado como respaldo)',
              data: { email, name, phone, company, message }
            });
          } else {
            // Si falla, intentar actualizar el contacto existente con PUT
            try {
              const updateResponse = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
                method: 'PUT',
                headers: {
                  'accept': 'application/json',
                  'api-key': BREVO_API_KEY,
                  'content-type': 'application/json'
                },
                body: JSON.stringify(contactDataWithBackup)
              });

              const updateResult = await handleBrevoResponse(updateResponse, email, name, phone, company, message);
              
              if (updateResult.ok) {
                return res.status(200).json({
                  ...updateResult,
                  message: 'Contacto actualizado exitosamente (teléfono guardado como respaldo)',
                  data: { email, name, phone, company, message }
                });
              } else {
                console.error('❌ Error al actualizar con PHONE_BACKUP:', updateResponse.status);
              }
            } catch (updateError) {
              console.error('❌ Error al intentar actualizar con PHONE_BACKUP:', updateError);
            }
            
            console.error('❌ Error al reintentar con PHONE_BACKUP:', retryResponse.status);
          }
        } catch (retryError) {
          console.error('❌ Error al reintentar con PHONE_BACKUP:', retryError);
        }
      }
    }

    // Si llegamos aquí, hubo un error que no pudimos manejar
    return res.status(500).json({
      ok: false,
      status: brevoResponse.status,
      code: errorCode,
      error: errorMessage || 'Error al procesar la solicitud con Brevo'
    });

  } catch (error) {
    console.error('❌ Error en handler:', error);
    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
}
