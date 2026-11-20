const form = document.getElementById("signin-form");
const error = document.getElementById("signin-error");
const modeButton = document.getElementById("account-mode");
const title = document.getElementById("signin-title");
const instruction = document.getElementById("signin-instruction");
document.getElementById("demo-form").addEventListener("submit", (event) => {
  event.preventDefault();
  sessionStorage.removeItem("info492-workspace-token");
  sessionStorage.removeItem("info492-workspace-user");
  sessionStorage.setItem("info492-role-session", JSON.stringify({ role: new FormData(event.currentTarget).get("role") }));
  location.assign("workspace.html");
});
let mode = "login";
const paint = () => {
  const registering = mode === "register";
  title.textContent = registering ? "Create your account" : "Sign in";
  instruction.textContent = registering
    ? "Enter a name, email, password, and role. Your account will open right away."
    : "Sign in with your email and password. If the email is new, we’ll switch to account setup.";
  document.getElementById("name-field").hidden = !registering;
  document.getElementById("role-field").hidden = !registering;
  form.elements.name.required = registering;
  form.elements.role.disabled = !registering;
  form.elements.password.autocomplete = registering ? "new-password" : "current-password";
  form.querySelector('[type="submit"]').textContent = registering ? "Create account" : "Sign in";
  modeButton.textContent = registering ? "Back to sign in" : "Create an account instead";
};
modeButton.addEventListener("click", () => {
  mode = mode === "login" ? "register" : "login";
  error.hidden = true;
  paint();
});
form.addEventListener("submit", async (event) => {
  event.preventDefault(); error.hidden = true;
  const values = Object.fromEntries(new FormData(form));
  try {
    const endpoint = mode === "register" ? "/api/workspace/register" : "/api/workspace/login";
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    let data;
    try { data = JSON.parse(await response.text()); }
    catch { throw new Error("The account API did not return JSON. Open this page through the running Node service, not a static file or static-hosted copy."); }
    if (!response.ok) {
      if (mode === "login" && data.code === "account_not_found") {
        mode = "register";
        error.textContent = "No account uses that email yet. Add your name and choose a role to create it.";
        paint(); form.elements.name.focus(); return;
      }
      if (mode === "register" && response.status === 409) {
        mode = "login";
        error.textContent = "This email already has an account. Sign in with its password.";
        paint(); return;
      }
      throw new Error(data.error || "Request failed.");
    }
    sessionStorage.setItem("info492-workspace-token", data.token);
    sessionStorage.setItem("info492-workspace-user", JSON.stringify(data.user));
    window.location.assign("workspace.html");
  } catch (e) {
    error.textContent = e instanceof TypeError
      ? "Cannot reach the account service. Start the Node app with npm start, then open the sign-in page from that same service."
      : e.message || "Unable to reach the workspace service.";
    error.hidden = false;
  }
});
paint();
