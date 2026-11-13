// The assistant filling a page of your portal, for a resident who is signed in. It is the portal sample's code with
// one more option, target: the element the chat fills, instead of a floating button and panel.
window.UCP =
  window.UCP ||
  function () {
    (UCP.q = UCP.q || []).push(arguments);
  };

UCP("mount", {
  widgetId: "{{WIDGET}}",
  target: "#assistant",
  getToken: () =>
    fetch("/widget-token", { credentials: "same-origin" }).then((reply) =>
      reply.ok ? reply.text() : Promise.reject(new Error(`no token: ${reply.status}`)),
    ),
});
