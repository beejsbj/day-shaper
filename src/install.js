const button = document.getElementById("installBtn");
const dialog = document.getElementById("installDlg");
const message = document.getElementById("installMessage");

let installPrompt = null;
let installed = false;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function updateAvailability() {
  button.hidden = installed || standalone();
}

updateAvailability();
matchMedia("(display-mode: standalone)").addEventListener?.("change", updateAvailability);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
});

window.addEventListener("appinstalled", () => {
  installed = true;
  installPrompt = null;
  updateAvailability();
});

button.addEventListener("click", async () => {
  if (standalone()) {
    updateAvailability();
    return;
  }

  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      const result = await prompt.userChoice;
      message.textContent = result.outcome === "accepted"
        ? "Dayshaper is being added to your device."
        : "Install was dismissed. You can still use Dayshaper in this browser.";
    } catch {
      message.textContent = "Use your browser's menu to install Dayshaper or add it to your home screen.";
    }
  } else if (ios()) {
    message.textContent = "To add Dayshaper to your home screen, tap the Share button in Safari, then choose Add to Home Screen.";
  } else {
    message.textContent = "This browser does not offer an install prompt. You can keep Dayshaper bookmarked and use it here; supported browsers may offer Add to Home Screen from their menu.";
  }

  if (!dialog.open) dialog.showModal();
});
