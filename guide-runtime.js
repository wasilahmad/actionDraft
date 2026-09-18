(() => {
  const editButton = document.getElementById("editToggle");
  const editableNodes = Array.from(document.querySelectorAll('[data-editable="true"]'));
  const header = document.querySelector(".page-header");

  if (!editButton || !header) {
    return;
  }

  const startEditing = header.dataset.startEditing === "true";
  const autoPrint = header.dataset.autoPrint === "true";
  let isEditing = startEditing;

  function applyEditState() {
    editableNodes.forEach((node) => {
      node.contentEditable = isEditing ? "true" : "false";
      node.spellcheck = isEditing;
    });
    editButton.textContent = isEditing ? "Done" : "Edit";
    document.body.classList.toggle("is-editing", isEditing);
  }

  editButton.addEventListener("click", () => {
    isEditing = !isEditing;
    applyEditState();
  });

  window.addEventListener("beforeprint", () => {
    editButton.style.display = "none";
  });

  window.addEventListener("afterprint", () => {
    editButton.style.display = "";
  });

  applyEditState();

  if (autoPrint) {
    setTimeout(() => {
      window.focus();
      window.print();
    }, 250);
  }
})();
