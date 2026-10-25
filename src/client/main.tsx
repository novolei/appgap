import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SteamApp } from "./SteamApp";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("root element missing");
}
createRoot(root).render(window.location.pathname.startsWith("/steam") ? <SteamApp /> : <App />);
