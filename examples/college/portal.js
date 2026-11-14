// The assistant on a portal page, for a resident who is signed in. Your portal's backend signs a short token for
// that resident at /widget-token (examples/token-signing has the code in six languages), and the chat asks for one
// when it starts and again every 15 minutes while it is in use.
window.UCP =
  window.UCP ||
  function () {
    (UCP.q = UCP.q || []).push(arguments);
  };

UCP("mount", {
  widgetId: "{{WIDGET}}",
  getToken: () =>
    fetch("/widget-token", { credentials: "same-origin" }).then((reply) =>
      reply.ok ? reply.text() : Promise.reject(new Error(`no token: ${reply.status}`)),
    ),
});

// When the resident signs out of your portal, remove the chat and its session too: UCP("unmount").
