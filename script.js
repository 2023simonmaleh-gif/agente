
/* Consultor medico: lógica del chat y conexión con el webhook. */

const formulario = document.getElementById("formulario-chat");
const entrada = document.getElementById("entrada");
const botonEnviar = document.getElementById("enviar");
const mensajes = document.getElementById("mensajes");
const estado = document.getElementById("estado");
const contador = document.getElementById("contador");

const TIEMPO_LIMITE = 20000;
const ESPERA_ENTRE_ENVIOS = 1500;

let enviando = false;
let ultimoEnvio = 0;

// Actualiza el contador de caracteres.
entrada.addEventListener("input", () => {
  contador.textContent = `${entrada.value.length} / 2000`;
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

// Extrae respuestas habituales de un webhook.
function extraerRespuesta(datos) {
  if (typeof datos === "string") return datos;

  if (datos && typeof datos === "object") {
    const respuesta =
      datos.respuesta ??
      datos.response ??
      datos.answer ??
      datos.mensaje ??
      datos.message;

    if (typeof respuesta === "string" && respuesta.trim()) {
      return respuesta;
    }
  }

  throw new Error("El webhook no devolvió una respuesta reconocida.");
}

// Gestiona el envío y los estados de carga, éxito y error.
formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const consulta = entrada.value.trim();

  if (!consulta || enviando) return;

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
    WEBHOOK_URL.includes("ejemplo-webhook-prueba")
  ) {
    mostrarEstado(
      "Configurá una URL de webhook válida en config.js para recibir respuestas.",
      "error"
    );
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
  contador.textContent = "0 / 2000";

  const controlador = new AbortController();
  const temporizador = setTimeout(
    () => controlador.abort(),
    TIEMPO_LIMITE
  );

  try {
    const respuestaHTTP = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain"
      },
      body: JSON.stringify({
        mensaje: consulta,
        agente: "Consultor medico"
      }),
      signal: controlador.signal
    });

    if (!respuestaHTTP.ok) {
      throw new Error(`Error HTTP ${respuestaHTTP.status}`);
    }

    const contenido = await respuestaHTTP.text();

    let datos;
    try {
      datos = JSON.parse(contenido);
    } catch {
      datos = contenido;
    }

    const respuesta = extraerRespuesta(datos);

    indicador.remove();
    agregarMensaje(respuesta, "agent");
    mostrarEstado("Respuesta recibida correctamente.", "success");

  } catch (error) {
    indicador.remove();

    const mensajeError = error.name === "AbortError"
      ? "La consulta tardó demasiado. Intentá nuevamente."
      : "No pudimos obtener una respuesta. Revisá el webhook e intentá nuevamente.";

    agregarMensaje(mensajeError, "agent");
    mostrarEstado(mensajeError, "error");

    console.error("Error en la consulta:", error);

  } finally {
    clearTimeout(temporizador);
    enviando = false;
    botonEnviar.disabled = false;
    entrada.disabled = false;
    entrada.focus();
  }
});
