/* Renders every Mermaid diagram on the page, then signals the PDF build. */
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  fontFamily: "Figtree, Arial, sans-serif",
  themeVariables: {
    fontSize: "14px",
    primaryColor: "#f5ead8",
    primaryBorderColor: "#c67139",
    primaryTextColor: "#201e1d",
    secondaryColor: "#e1eecc",
    secondaryBorderColor: "#7a8a5e",
    tertiaryColor: "#fff2eb",
    lineColor: "#645c50",
    textColor: "#201e1d",
    clusterBkg: "#fbf6ee",
    clusterBorder: "#dcd3c4",
    edgeLabelBackground: "#ffffff",
    actorBkg: "#f5ead8",
    actorBorder: "#c67139",
    actorTextColor: "#201e1d",
    signalColor: "#474238",
    signalTextColor: "#201e1d",
    labelBoxBkgColor: "#f5ead8",
    labelBoxBorderColor: "#c67139",
    noteBkgColor: "#fff2eb",
    noteBorderColor: "#c67139",
    noteTextColor: "#201e1d",
    activationBkgColor: "#e1eecc",
    activationBorderColor: "#7a8a5e",
  },
  flowchart: { curve: "basis", useMaxWidth: true, padding: 12 },
  sequence: { useMaxWidth: true, mirrorActors: false, wrap: true, messageAlign: "center" },
  state: { useMaxWidth: true },
});

(async () => {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await mermaid.run({ querySelector: ".mermaid" });
    const failed = [...document.querySelectorAll(".mermaid")].filter(
      (el) => !el.querySelector("svg") || /syntax error/i.test(el.textContent || ""),
    );
    if (failed.length) throw new Error(`${failed.length} diagram(s) failed to render`);

    // A diagram must fit on one page. The build lays the page out at the PDF's
    // printable width, so these heights are the printed ones; anything taller than
    // a page (less its caption) is scaled down, keeping its proportions.
    const MAX_HEIGHT_PX = 880;
    for (const svg of document.querySelectorAll(".mermaid svg")) {
      const { width, height } = svg.getBoundingClientRect();
      if (height > MAX_HEIGHT_PX) {
        svg.style.width = `${Math.floor((width * MAX_HEIGHT_PX) / height)}px`;
        svg.style.maxWidth = "100%";
        svg.style.height = "auto";
      }
    }
    window.__docReady = true;
  } catch (error) {
    window.__docError = String((error && error.message) || error);
  }
})();
