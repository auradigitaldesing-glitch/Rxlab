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
      phone: phone ? `${phone.substring(0, 10)}*** (${phone.length} chars)` : 'VACÍO',
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

    // Agregar teléfono si existe
    let phoneLocal = null;
    let phoneSMS = null;
    if (phone && phone.trim()) {
      console.log('📱 Teléfono recibido en backend:', phone);
      
      // Limpiar el teléfono: eliminar espacios, guiones, paréntesis, puntos, etc.
      let phoneCleaned = phone.replace(/[\s\-\(\)\.]/g, '');
      console.log('📱 Teléfono limpiado:', phoneCleaned);
      
      // Extraer solo el número local (remover código de país si existe)
      phoneLocal = phoneCleaned;
      
      if (phoneLocal.startsWith('+52')) {
        // Si ya tiene +52, removerlo para obtener solo el número local
        phoneLocal = phoneLocal.replace(/^\+52/, '');
        phoneSMS = phoneCleaned; // Usar el número completo con +52 para SMS
        console.log('📱 Teléfono con +52 detectado. Local:', phoneLocal, 'SMS:', phoneSMS);
      } else if (phoneLocal.startsWith('+')) {
        // Si tiene otro código de país, removerlo
        phoneLocal = phoneLocal.replace(/^\+?\d{1,3}/, '');
        phoneSMS = '+52' + phoneLocal; // Agregar +52 para SMS
        console.log('📱 Teléfono con otro código detectado. Local:', phoneLocal, 'SMS:', phoneSMS);
      } else if (phoneLocal.startsWith('00')) {
        // Remover 00 y código de país
        phoneLocal = phoneLocal.replace(/^00\d{1,3}/, '');
        phoneSMS = '+52' + phoneLocal; // Agregar +52 para SMS
        console.log('📱 Teléfono con 00 detectado. Local:', phoneLocal, 'SMS:', phoneSMS);
      } else {
        // Si no tiene código de país, asumir que es número local
        phoneSMS = '+52' + phoneLocal; // Agregar +52 para SMS
        console.log('📱 Teléfono sin código detectado. Local:', phoneLocal, 'SMS:', phoneSMS);
      }
      
      // Validar que phoneLocal tenga al menos 7 dígitos
      if (!phoneLocal || phoneLocal.length < 7) {
        console.warn('⚠️ Teléfono local muy corto, usando número completo');
        phoneLocal = phoneCleaned.replace(/^\+52/, '') || phoneCleaned.replace(/^\+/, '');
        phoneSMS = phoneCleaned.startsWith('+') ? phoneCleaned : '+52' + phoneCleaned;
      }
      
      // Asegurar que phoneSMS tenga el formato correcto
      if (!phoneSMS || !phoneSMS.startsWith('+52')) {
        phoneSMS = '+52' + phoneLocal;
      }
      
      // Para TELEFONO (tipo Número): solo números locales (sin código de país)
      const telefonoNumero = parseInt(phoneLocal);
      if (telefonoNumero && !isNaN(telefonoNumero)) {
        contactData.attributes.TELEFONO = telefonoNumero;
      } else {
        contactData.attributes.TELEFONO = phoneLocal;
      }
      console.log('✅ Teléfono local agregado a Brevo (TELEFONO):', phoneLocal.substring(0, Math.min(6, phoneLocal.length)) + '***');
      
      // Para SMS (tipo Texto): formato E.164 completo con +52 (Brevo requiere este formato)
      contactData.attributes.SMS = phoneSMS;
      console.log('✅ Teléfono agregado a Brevo (SMS con formato E.164):', phoneSMS.substring(0, Math.min(6, phoneSMS.length)) + '***');
    } else {
      console.log('⚠️ No se proporcionó teléfono o está vacío');
    }

    // Log del payload que se enviará a Brevo (con detalles de atributos)
    console.log('📤 Payload final enviado a Brevo:', {
      email: contactData.email,
      attributes: {
        keys: Object.keys(contactData.attributes),
        TELEFONO: contactData.attributes.TELEFONO ? (String(contactData.attributes.TELEFONO).substring(0, 6) + '***') : 'NO DEFINIDO',
        SMS: contactData.attributes.SMS ? (contactData.attributes.SMS.substring(0, 6) + '***') : 'NO DEFINIDO',
        NOMBRE: contactData.attributes.NOMBRE,
        APELLIDOS: contactData.attributes.APELLIDOS,
        EMPRESA: contactData.attributes.EMPRESA || 'NO DEFINIDO'
      },
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
      const isEmailDuplicate = errorCode === 'duplicate_parameter' && 
                               (errorMessage.toLowerCase().includes('email') || 
                                errorMessage.toLowerCase().includes('contact'));
      
      const isSMSDuplicate = errorCode === 'duplicate_parameter' && 
                             (errorMessage.includes('SMS') || 
                              errorMessage.includes('phone') || 
                              errorMessage.includes('teléfono') ||
                              errorMessage.includes('mobile') ||
                              errorMessage.includes('already associated'));

      let shouldUseBackup = false; // Flag para saber si debemos usar PHONE_BACKUP

      // Caso 1: Intentar actualizar por email primero (esto debería funcionar en la mayoría de casos)
      if (isEmailDuplicate || isSMSDuplicate) {
        console.log('🔄 Contacto duplicado detectado, intentando actualizar por email...');
        
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
            console.log('✅ Contacto actualizado exitosamente con todos los atributos incluyendo SMS');
            return res.status(200).json({
              ...updateResult,
              data: { email, name, phone, company, message }
            });
          } else {
            // Si la actualización falla, usar el errorResult que ya viene de handleBrevoResponse
            const updateErrorMessage = updateResult.message || '';
            const updateErrorCode = updateResult.code;
            const updateErrorResult = updateResult.errorResult;
            
            const isSMSStillDuplicate = updateErrorMessage.includes('SMS') || 
                                       updateErrorMessage.includes('phone') ||
                                       updateErrorMessage.includes('teléfono') ||
                                       updateErrorMessage.includes('mobile');
            
            if (isSMSStillDuplicate && phoneLocal) {
              console.log('⚠️ SMS duplicado en otro contacto, guardando en PHONE_BACKUP...');
              shouldUseBackup = true; // Marcar para usar PHONE_BACKUP
            } else {
              console.error('❌ Error al actualizar contacto:', updateResponse.status);
              return res.status(500).json({
                ok: false,
                status: updateResponse.status,
                code: updateErrorCode,
                error: updateErrorMessage || 'Error al procesar la solicitud con Brevo'
              });
            }
          }
        } catch (updateError) {
          console.error('❌ Error al intentar actualizar:', updateError);
          // Si hay error al actualizar y es SMS duplicado, usar PHONE_BACKUP
          if (isSMSDuplicate && phoneLocal) {
            console.log('⚠️ Error al actualizar, intentando con PHONE_BACKUP...');
            shouldUseBackup = true;
          } else {
            return res.status(500).json({
              ok: false,
              error: 'Error al procesar la solicitud con Brevo'
            });
          }
        }
      }

      // Caso 2: Si el SMS está duplicado y no se pudo actualizar, guardar en PHONE_BACKUP
      // También si el email no existe pero el SMS está duplicado
      if ((shouldUseBackup || (isSMSDuplicate && !isEmailDuplicate)) && phoneLocal) {
        console.log('⚠️ SMS duplicado, teléfono guardado como PHONE_BACKUP');
        
        // Crear contacto sin SMS pero con PHONE_BACKUP
        const contactDataWithBackup = {
          email: email,
          attributes: {
            NOMBRE: NOMBRE,
            APELLIDOS: APELLIDOS,
            PHONE_BACKUP: phoneLocal
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
    console.error('❌ Stack trace:', error.stack);
    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Error al procesar la solicitud'
    });
  }
}
