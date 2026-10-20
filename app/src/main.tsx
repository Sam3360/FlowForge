import ReactDOM from "react-dom/client";
import { App, type Services } from "./App";
import { EngineClient } from "./engine/client";
import { TauriTransport } from "./engine/tauriTransport";
import { tauriFiles } from "./services/files";
import "./styles/app.css";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const services: Services = { engine: inTauri ? new EngineClient(new TauriTransport()) : null, files: tauriFiles };

ReactDOM.createRoot(document.getElementById("root")!).render(<App services={services} />);
