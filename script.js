/* Consultor medico: lógica del chat y conexión con el webhook. */

const formulario = document.getElementById("formulario-chat");
const entrada = document.getElementById("entrada");
const botonEnviar = document.getElementById("enviar");
const mensajes = document.getElementById("mensajes");
const estado = document.getElementById("estado");
const contador = document.getElementById("contador");

const TIEMPO_LIMITE = 30000;
const ESPERA_ENTRE_ENVIOS = 1500;

let enviando = false;
let ultimoEnvio = 0;

// Generar o recuperar sessionId único de manera segura
let sessionId;
try {
  sessionId = localStorage.getItem("chat_session_id");
  if (!sessionId) {
    sessionId = typeof crypto !== "undefined" && crypto.randomUUID 
      ? crypto.randomUUID() 
      : 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("chat_session_id", sessionId);
  }
} catch (e) {
  sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Actualiza el contador de caracteres y valida el límite de 500
entrada.addEventListener("input", () => {
  if (entrada.value.length > 500) {
    entrada.value = entrada.value.slice(0, 500);
  }
  contador.textContent = `${entrada.value.length} / 500`;
});

// Permite enviar con Enter y escribir varias líneas con Shift + Enter.
entrada.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey) {
    evento.preventDefault();
    formulario.requestSubmit();
  }
});

// Crea una burbuja sin interpretar el contenido como HTML.
function agregarMensaje(texto, tipo) {
  const articulo = document.createElement("article");
  articulo.className = `message ${tipo}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = tipo === "agent" ? "✦" : "Tú";

  const burbuja = document.createElement("div");
  burbuja.className = "bubble";

  const remitente = document.createElement("span");
  remitente.className = "sender";
  remitente.textContent =
    tipo === "agent" ? "Consultor medico" : "Vos";

  const parrafo = document.createElement("p");
  parrafo.textContent = texto;

  const hora = document.createElement("time");
  hora.textContent = new Date().toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit"
  });

  burbuja.append(remitente, parrafo, hora);
  articulo.append(avatar, burbuja);
  mensajes.appendChild(articulo);

  mensajes.scrollTop = mensajes.scrollHeight;
  return articulo;
}

// Informa al usuario sobre el estado de la petición.
function mostrarEstado(texto, tipo = "") {
  estado.textContent = texto;
  estado.className = `feedback ${tipo}`.trim();
}

// Procesa y limpia la respuesta de Make con alta tolerancia a formatos
function procesarRespuestaMake(textoBruto) {
  let texto = textoBruto.trim();

  if (!texto) {
    return "(respuesta vacía)";
  }

  // Limpiar envoltorios de bloques de código Markdown (ej. ```json ... ```)
  if (texto.startsWith("```")) {
    texto = texto.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }

  try {
    const datos = JSON.parse(texto);
    return extraerValorObjeto(datos);
  } catch (e) {
    // Si falla JSON.parse pero parece un objeto JSON, intentamos escapar saltos de línea internos o extraer por regex
    if (texto.startsWith("{") && texto.endsWith("}")) {
      try {
        const textoEscapado = texto.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
        const datosEscapados = JSON.parse(textoEscapado);
        return extraerValorObjeto(datosEscapados);
      } catch (err2) {
        // Extracción por expresión regular de propiedades clave comunes
        for (const clave of ["response", "respuesta", "message", "mensaje"]) {
          const regex = new RegExp(`["']?${clave}["']?\\s*:\\s*["']([^"']+)["']`, "i");
          const match = texto.match(regex);
          if (match && match[1]) {
            return match[1].trim();
          }
        }
      }
    }

    // Si es texto plano real o no es un objeto válido, se devuelve tal cual
    return texto;
  }
}

// Extrae el primer valor de texto no vacío entre las propiedades prioritarias
function extraerValorObjeto(datos) {
  if (datos === null || datos === undefined) {
    return "(respuesta vacía)";
  }

  if (typeof datos !== "object") {
    return String(datos);
  }

  const claveEncontrada = ["response", "respuesta", "message", "mensaje"].find(
    (k) => typeof datos[k] === "string" && datos[k].trim() !== ""
  );

  if (claveEncontrada) {
    return datos[claveEncontrada].trim();
  }

  return "Make respondió, pero sin el campo response";
}

// Gestiona el envío y los estados de carga, éxito y error.
formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const consulta = entrada.value.trim();

  if (!consulta || enviando) return;

  if (consulta.length > 500) {
    mostrarEstado("El mensaje no puede superar los 500 caracteres.", "error");
    return;
  }

  // Evita envíos demasiado seguidos.
  const ahora = Date.now();
  const tiempoRestante =
    ESPERA_ENTRE_ENVIOS - (ahora - ultimoEnvio);

  if (tiempoRestante > 0) {
    mostrarEstado(
      `Esperá ${Math.ceil(tiempoRestante / 1000)} segundo(s) antes de enviar otra consulta.`,
      "error"
    );
    return;
  }

  if (
    !WEBHOOK_URL ||
    WEBHOOK_URL.includes("ACA VA") ||
    WEBHOOK_URL.includes("ejemplo-webhook-prueba")
  ) {
    mostrarEstado("Falta pegar la URL de tu webhook en config.js", "error");
    return;
  }

  enviando = true;
  ultimoEnvio = Date.now();
  botonEnviar.disabled = true;
  entrada.disabled = true;

  agregarMensaje(consulta, "user");

  // Indicador visual de carga.
  const indicador = agregarMensaje("", "agent");
  const parrafoCarga = indicador.querySelector(".bubble p");
  parrafoCarga.className = "typing";
  parrafoCarga.setAttribute("aria-label", "Consultor medico está respondiendo");

  for (let i = 0; i < 3; i++) {
    const punto = document.createElement("span");
    punto.setAttribute("aria-hidden", "true");
    parrafoCarga.appendChild(punto);
  }

  mostrarEstado("Enviando tu consulta...", "");
  entrada.value = "";
  contador.textContent = "0 / 500";

  const controlador = new AbortController();
  const temporizador = setTimeout(
    () => controlador.abort(),
    TIEMPO_LIMITE
  );

  try {
    const respuestaHTTP = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sessionId,
        mensaje: consulta,
        fecha: new Date().toISOString()
      }),
      signal: controlador.signal
    });

    if (!respuestaHTTP.ok) {
      throw new Error(`Make respondió con error (código ${respuestaHTTP.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`);
    }

    const contenidoBruto = await respuestaHTTP.text();
    const respuestaProcesada = procesarRespuestaMake(contenidoBruto);

    indicador.remove();
    agregarMensaje(respuestaProcesada, "agent");
    mostrarEstado("Respuesta recibida correctamente.", "success");

  } catch (error) {
    indicador.remove();

    let mensajeError = error.message;
    let tipoError = "error";

    if (error.name === "AbortError") {
      mensajeError = "La solicitud tardó demasiado tiempo en responder (tiempo agotado).";
    } else if (!navigator.onLine || error.message.includes("Failed to fetch")) {
      mensajeError = "Hubo un fallo de red. Comprobá tu conexión a internet.";
    }

    agregarMensaje(mensajeError, "agent");
    mostrarEstado(mensajeError, tipoError);

    console.error("Error en la consulta:", error);

  } finally {
    clearTimeout(temporizador);
    enviando = false;
    botonEnviar.disabled = false;
    entrada.disabled = false;
    entrada.focus();
  }
});
