let lastPlayedUpdatedAt = null;
let pendingSoundUrl = null;

async function playSound(soundUrl) {
  const audio = new Audio(soundUrl);

  try {
    await audio.play();
    pendingSoundUrl = null;
    return true;
  } catch (error) {
    if (error.name === "NotAllowedError") {
      pendingSoundUrl = soundUrl;
      return false;
    }

    console.error("Could not play overlay sound:", error);
    return false;
  }
}

async function retryPendingSound() {
  if (!pendingSoundUrl) {
    return;
  }

  await playSound(pendingSoundUrl);
}

document.addEventListener("pointerdown", retryPendingSound);
document.addEventListener("keydown", retryPendingSound);

async function loadState() {
  try {
    const response = await fetch("/state");

    if (!response.ok) {
      throw new Error(`State request failed: ${response.status}`);
    }

    const state = await response.json();

    const box = document.getElementById("box");
    const title = document.getElementById("title");
    const subtitle = document.getElementById("subtitle");

    if (!state.visible) {
      box.style.display = "none";
      return;
    }

    title.textContent = state.title;
    subtitle.textContent = state.subtitle;
    box.style.borderLeftColor = state.color || "#ffcc00";
    box.style.display = "block";

    if (state.sound && state.updatedAt !== lastPlayedUpdatedAt) {
      const soundUrl = `/sounds/${encodeURIComponent(state.sound)}`;
      await playSound(soundUrl);
      lastPlayedUpdatedAt = state.updatedAt;
    }
  } catch (error) {
    console.error("Could not load overlay state:", error);
  }
}

setInterval(loadState, 500);
loadState();
