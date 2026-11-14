// Our hosted copy of the full-page sample. "Signing in" is choosing a name, and this site signs a demo token for it
// at /demo-token (infra/aws/dev/functions/demo-token.js), standing in for a portal's backend.
window.UCP =
  window.UCP ||
  function () {
    (UCP.q = UCP.q || []).push(arguments);
  };

const user = new URLSearchParams(location.search).get("user");
if (user) {
  document.getElementById("sign-in").hidden = true;
  document.getElementById("signed-in").hidden = false;
  document.getElementById("name").textContent = user;
  UCP("mount", {
    widgetId: "{{DEMO_WIDGET}}",
    target: "#assistant",
    getToken: () =>
      fetch(`/demo-token?user=${encodeURIComponent(user)}`).then((reply) =>
        reply.ok ? reply.text() : Promise.reject(new Error(`no token: ${reply.status}`)),
      ),
  });
}
