import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SteamApp } from "./SteamApp";
import "./styles.css";
import { SiteShell } from "./SiteShell";
import { AccountPage, LoginPage } from "./AccountPages";
import { SupportPage } from "./SupportPage";

const root = document.getElementById("root");
if (!root) {
  throw new Error("root element missing");
}
const path=window.location.pathname;
createRoot(root).render(<SiteShell>{path==="/login"||path==="/register" ? <LoginPage/> : path==="/account" ? <AccountPage/> : path==="/support" ? <SupportPage/> : path.startsWith("/steam") ? <SteamApp/> : <App/>}</SiteShell>);
