window.icon = (name) => {
  const paths = {
    overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    prices: "M3 17l5-6 4 3 8-10 M16 4h4v4",
    forecasts: "M3 18h18 M5 14l4-7 5 6 5-9",
    demand: "M3 18h18 M4 13h4l3-8 4 12 3-6h3",
    weather: "M7 16a5 5 0 1 1 9-4 4 4 0 0 1 1 8H7a4 4 0 0 1 0-8 M8 2v2 M2 8h2",
    resources: "M4 7h15v12H4z M19 11h2v4h-2 M11 9l-3 5h4l-2 3",
    reports: "M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h6",
    health: "M12 3l9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5",
    refresh: "M20 7v5h-5 M20 12a8 8 0 1 0-2 6",
    analysis: "M4 20h16 M7 16v-5 M12 16V4 M17 16V8",
    ancillary: "M3 12h5l3-8 4 16 3-8h3",
    fuels: "M12 3c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 4-7v5c2-2 2-5 2-9",
    download: "M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4",
  };
  return `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.overview}"/></svg>`;
};
