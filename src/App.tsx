import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronRight,
  CloudLightning,
  Compass,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Flag,
  Leaf,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Volume2,
  Wifi,
  Users,
  X,
} from "lucide-react";
import WorldView from "./World";
import {
  advance,
  applyDecision,
  clock,
  createWorld,
  intervene,
  localDecision,
  log,
  observe,
  parseSave,
  recordNpcReply,
  type World,
} from "./engine";
import { decisionSchema, instancePlanSchema } from "./contracts";
const SAVE_KEY = "sim-proj1-world-v1";
const OPENROUTER_SESSION_KEY = "sim-proj1-openrouter-key";
const VOICE_KEY = "sim-proj1-voice-settings";
const SETTINGS_KEY = "sim-proj1-settings-v1";
type OpenRouterModel = {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  promptPrice: string;
  completionPrice: string;
  free: boolean;
};
type VoiceSettings = {
  enabled: boolean;
  rate: number;
  voices: Record<string, string>;
};
function readSavedSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as {
      model?: string;
      worldPrompt?: string;
    };
  } catch {
    return {};
  }
}
function pricePerMillion(value: string) {
  const cost = Number(value) * 1_000_000;
  if (!Number.isFinite(cost)) return "?";
  return cost < 0.01 ? "< $0.01" : `$${cost.toFixed(cost < 1 ? 2 : 1)}`;
}
function ModelPicker({
  kind,
  models,
  selected,
  loading,
  onSelect,
}: {
  kind: "free" | "paid";
  models: OpenRouterModel[];
  selected: string;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = models
    .filter((candidate) => candidate.free === (kind === "free"))
    .filter((candidate) =>
      `${candidate.name} ${candidate.id}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    )
    .slice(0, 120);
  const selectedHere = filtered.some((candidate) => candidate.id === selected);
  return (
    <div className="model-picker">
      <label htmlFor={`${kind}-model-search`}>
        {kind === "free" ? "Free models" : "OpenRouter credit models"}
      </label>
      <div className="model-search">
        <Search size={15} />
        <input
          id={`${kind}-model-search`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${kind === "free" ? "free" : "credit"} models…`}
          role="searchbox"
        />
      </div>
      <select
        aria-label={
          kind === "free" ? "Available free models" : "Available credit models"
        }
        value={selectedHere ? selected : ""}
        onChange={(event) => onSelect(event.target.value)}
        disabled={loading || filtered.length === 0}
      >
        <option value="">
          {loading
            ? "Loading current models…"
            : filtered.length
              ? `Choose from ${filtered.length} matching models…`
              : "No matching models"}
        </option>
        {filtered.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name} · {candidate.id}
            {kind === "paid"
              ? ` · in ${pricePerMillion(candidate.promptPrice)}/M · out ${pricePerMillion(candidate.completionPrice)}/M`
              : " · FREE"}
          </option>
        ))}
      </select>
      <span className="micro">
        {filtered.length} current catalog match
        {filtered.length === 1 ? "" : "es"}
      </span>
    </div>
  );
}
type Panel = "agents" | "intervene" | "journal" | "settings" | null;
export default function App() {
  const world = useRef<World>(createWorld());
  const [snapshot, setSnapshot] = useState(world.current);
  const [paused, setPausedState] = useState(false);
  const pausedRef = useRef(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [cameraReset, setCameraReset] = useState(0);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState(() => {
    try {
      return sessionStorage.getItem(OPENROUTER_SESSION_KEY) || "";
    } catch {
      return "";
    }
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [mode, setMode] = useState<"local" | "live">("local");
  const [model, setModel] = useState(
    () => readSavedSettings().model || "openai/gpt-4o-mini",
  );
  const [thinking, setThinking] = useState<string | null>(null);
  const [aiError, setAiError] = useState("");
  const [worldPrompt, setWorldPrompt] = useState(
    () =>
      readSavedSettings().worldPrompt ||
      "A small isolated research habitat where three people must restore communications before nightfall.",
  );
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [connectionTest, setConnectionTest] = useState<{
    state: "idle" | "testing" | "success" | "error";
    text: string;
  }>({ state: "idle", text: "" });
  const [generatingWorld, setGeneratingWorld] = useState(false);
  const [contextAgent, setContextAgent] = useState("mira");
  const [availableVoices, setAvailableVoices] = useState<
    SpeechSynthesisVoice[]
  >([]);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(VOICE_KEY) || "null") || {
          enabled: false,
          rate: 1,
          voices: {},
        }
      );
    } catch {
      return { enabled: false, rate: 1, voices: {} };
    }
  });
  const [saveExists, setSaveExists] = useState(() => {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  });
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resultHidden, setResultHidden] = useState(false);
  const generation = useRef(0),
    roundRobin = useRef(0),
    busy = useRef(false),
    liveEnabled = useRef(false);
  const lastAi = useRef(0);
  const lastEvent = useRef<HTMLDivElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const spokenUntil = useRef<Record<string, number>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  // Stop simulation synchronously: React effects can run after the next frame.
  const setPaused = (value: boolean | ((previous: boolean) => boolean)) => {
    const next = typeof value === "function" ? value(pausedRef.current) : value;
    pausedRef.current = next;
    generation.current++;
    setPausedState(next);
  };
  const refresh = () => setSnapshot({ ...world.current });
  const notify = (text: string) => {
    setNotice(text);
  };
  const updateApiKey = (value: string) => {
    const next = value.trim();
    setApiKey(next);
    generation.current++;
    try {
      if (next) sessionStorage.setItem(OPENROUTER_SESSION_KEY, next);
      else sessionStorage.removeItem(OPENROUTER_SESSION_KEY);
    } catch {
      // The key still works for the current page when session storage is blocked.
    }
    if (!next && !configured) setMode("local");
    setAiError("");
  };
  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((s) => {
        setConfigured(s.configured === true);
        if (s.model && !readSavedSettings().model) setModel(s.model);
      })
      .catch(() =>
        setAiError(
          "The API server is unavailable. Local simulation still works.",
        ),
      );
  }, []);
  useEffect(() => {
    if (panel !== "settings") return;
    const controller = new AbortController();
    setModelsLoading(true);
    setModelsError("");
    fetch("/api/models", {
      headers: apiKey ? { "X-OpenRouter-Key": apiKey } : {},
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw Error(data.error || "Could not load available models.");
        setModels(data.models || []);
      })
      .catch((error) => {
        if (error instanceof Error && error.name !== "AbortError")
          setModelsError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setModelsLoading(false);
      });
    return () => controller.abort();
  }, [panel, catalogRefresh, apiKey]);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => setAvailableVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(VOICE_KEY, JSON.stringify(voiceSettings));
    } catch {
      // Voice choices still work for the current page.
    }
  }, [voiceSettings]);
  useEffect(() => {
    if (!voiceSettings.enabled || !("speechSynthesis" in window)) return;
    for (const a of snapshot.agents) {
      if (
        !a.message ||
        a.messageUntil <= snapshot.time ||
        a.messageUntil <= (spokenUntil.current[a.id] || 0)
      )
        continue;
      spokenUntil.current[a.id] = a.messageUntil;
      const utterance = new SpeechSynthesisUtterance(a.message);
      utterance.rate = voiceSettings.rate;
      const selectedVoice = availableVoices.find(
        (voice) => voice.name === voiceSettings.voices[a.id],
      );
      if (selectedVoice) utterance.voice = selectedVoice;
      window.speechSynthesis.speak(utterance);
    }
  }, [snapshot.sequence, snapshot.time, voiceSettings, availableVoices]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    liveEnabled.current = mode === "live";
    generation.current++;
  }, [mode, paused]);
  useEffect(() => {
    let previous = performance.now(),
      ui = 0;
    let frame: number;
    const tick = (now: number) => {
      const elapsed = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      if (!pausedRef.current) {
        advance(world.current, elapsed * speed, mode === "local");
        if (mode === "live") {
          for (const a of world.current.agents)
            if (
              !a.decision &&
              a.cooldown <= 0 &&
              thinking !== a.id &&
              now - lastAi.current < 8000
            )
              applyDecision(
                world.current,
                a.id,
                localDecision(world.current, a),
              );
        }
      }
      ui += elapsed;
      if (ui > 0.12) {
        refresh();
        ui = 0;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused, speed, mode, thinking]);
  useEffect(() => {
    if (mode !== "live" || paused || connectionTest.state === "testing") return;
    const timer = setInterval(async () => {
      const w = world.current;
      if (
        pausedRef.current ||
        busy.current ||
        w.outcome !== "running" ||
        performance.now() - lastAi.current < 8000
      )
        return;
      const agent = w.agents[roundRobin.current++ % 3];
      const token = generation.current;
      const capturedInbox = agent.inbox;
      busy.current = true;
      setThinking(agent.id);
      lastAi.current = performance.now();
      try {
        const res = await fetch("/api/decide", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "X-OpenRouter-Key": apiKey } : {}),
          },
          body: JSON.stringify({ model, observation: observe(w, agent) }),
          signal: AbortSignal.timeout(23000),
        });
        const data = await res.json();
        if (!res.ok) throw Error(data.error || "Model connection failed.");
        if (
          token !== generation.current ||
          !liveEnabled.current ||
          agent.inbox !== capturedInbox
        )
          return;
        const d = decisionSchema.parse(data.decision);
        if (!applyDecision(w, agent.id, d))
          throw Error(
            "The requested action is not possible right now. Local behavior will continue.",
          );
        if (capturedInbox) {
          const reply =
            d.message.trim() ||
            "I hear you. I’ll keep that in mind as I decide what to do.";
          recordNpcReply(w, agent, reply);
          if (agent.decision) agent.decision.message = "";
        }
        delete agent.inbox;
        setAiError("");
        log(w, "system", `${agent.name} chose to ${d.action} · OpenRouter`);
      } catch (e) {
        if (token === generation.current) {
          const error = e instanceof Error ? e.message : "Connection failed.";
          setAiError(error);
          if (!agent.decision)
            applyDecision(w, agent.id, localDecision(w, agent));
        }
      } finally {
        busy.current = false;
        setThinking(null);
        refresh();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [mode, paused, model, apiKey, connectionTest.state]);
  useEffect(() => {
    lastEvent.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [snapshot.sequence, panel]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [snapshot.sequence, selected]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,textarea,select,button"))
        return;
      if (e.code === "Space") {
        e.preventDefault();
        setPaused((v) => !v);
      }
      if (e.key === "Escape") {
        setPanel(null);
        setSelected(null);
        setResetConfirm(false);
      }
      if (e.key.toLowerCase() === "r") setCameraReset((v) => v + 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const choose = (id: string) => {
    setSelected(id);
    setPanel("agents");
  };
  const toggle = (p: Panel) => setPanel((old) => (old === p ? null : p));
  const intervention = (type: "food" | "storm" | "calm") => {
    generation.current++;
    intervene(world.current, type);
    refresh();
    notify(
      type === "food"
        ? "Supply drone delivered 4 portions."
        : type === "storm"
          ? "Storm introduced. Watch how the crew adapts."
          : "Weather cleared.",
    );
  };
  const save = () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(world.current));
      setSaveExists(true);
      notify("Experiment saved in this browser.");
    } catch {
      notify("Browser storage is unavailable. Use Export instead.");
    }
  };
  const saveSettings = (messageText: string, includeWorld = false) => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ model, worldPrompt: worldPrompt.trim() }),
      );
      localStorage.setItem(VOICE_KEY, JSON.stringify(voiceSettings));
      if (includeWorld) {
        localStorage.setItem(SAVE_KEY, JSON.stringify(world.current));
        setSaveExists(true);
      }
      notify(messageText);
    } catch {
      notify(
        "Browser storage is unavailable. Settings remain active for this tab.",
      );
    }
  };
  const chooseModel = (id: string) => {
    if (!id) return;
    generation.current++;
    setModel(id);
    setAiError("");
    setConnectionTest({ state: "idle", text: "" });
  };
  const testConnection = async () => {
    if (!providerReady || !model) return;
    if (model === "openrouter/free") {
      setConnectionTest({
        state: "error",
        text: "Choose a specific model from the Free models list. The automatic free router can change models between requests and is unreliable for simulation actions.",
      });
      return;
    }
    setConnectionTest({ state: "testing", text: "Testing model…" });
    try {
      const response = await fetch("/api/test-connection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-OpenRouter-Key": apiKey } : {}),
        },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(23000),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error || "The connection test failed.");
      setConnectionTest({
        state: "success",
        text: `Connected in ${data.latencyMs} ms. JSON responses are compatible.`,
      });
      setAiError("");
    } catch (error) {
      setConnectionTest({
        state: "error",
        text:
          error instanceof Error
            ? error.message
            : "The connection test failed.",
      });
    }
  };
  const load = () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) throw Error();
      const w = parseSave(raw);
      generation.current++;
      world.current = w;
      setResultHidden(false);
      setPaused(true);
      refresh();
      notify("Saved experiment restored and paused.");
    } catch {
      notify("Could not load this save. The current experiment is unchanged.");
    }
  };
  const exportSave = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(world.current, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "sim-proj1-experiment.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Experiment exported.");
  };
  const importSave = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 250000) throw Error();
      const w = parseSave(await file.text());
      generation.current++;
      world.current = w;
      setResultHidden(false);
      setPaused(true);
      refresh();
      notify("Experiment imported and paused.");
    } catch {
      notify("Invalid or incompatible save. Your current world is unchanged.");
    }
  };
  const reset = () => {
    generation.current++;
    world.current = createWorld();
    lastAi.current = 0;
    setPaused(false);
    setResetConfirm(false);
    setResultHidden(false);
    setAiError("");
    refresh();
    notify("A new day begins.");
  };
  const generateWorld = async () => {
    if (!providerReady || worldPrompt.trim().length < 10) return;
    setGeneratingWorld(true);
    setAiError("");
    try {
      const res = await fetch("/api/world/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-OpenRouter-Key": apiKey } : {}),
        },
        body: JSON.stringify({ model, prompt: worldPrompt.trim() }),
        signal: AbortSignal.timeout(28000),
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error || "World generation failed.");
      const instance = instancePlanSchema.parse(data.instance);
      generation.current++;
      world.current = createWorld(instance);
      spokenUntil.current = {};
      setSelected(null);
      setResultHidden(false);
      setPaused(true);
      refresh();
      notify(`${instance.title} created and paused for review.`);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "World generation failed.");
    } finally {
      setGeneratingWorld(false);
    }
  };
  const updateSituation = (value: string) => {
    world.current.instance.situation = value.slice(0, 600);
    generation.current++;
    refresh();
  };
  const updateCharacter = (
    id: string,
    field: "personality" | "goal" | "memories" | "memoryLimit",
    value: string | number,
  ) => {
    const target = world.current.agents.find(
      (candidate) => candidate.id === id,
    );
    if (!target) return;
    if (field === "memories")
      target.memories = String(value)
        .split("\n")
        .map((item) => item.trim().slice(0, 400))
        .filter(Boolean)
        .slice(-target.memoryLimit);
    else if (field === "memoryLimit") {
      target.memoryLimit = Math.max(4, Math.min(30, Number(value)));
      target.memories = target.memories.slice(-target.memoryLimit);
    } else target[field] = String(value).slice(0, field === "goal" ? 300 : 500);
    generation.current++;
    refresh();
  };
  const send = () => {
    if (!message.trim() || !selected) return;
    generation.current++;
    intervene(world.current, "message", selected, message);
    setMessage("");
    refresh();
    notify(
      paused
        ? "Message delivered. Resume to see the response."
        : "Message delivered.",
    );
  };
  const agent = snapshot.agents.find((a) => a.id === selected);
  const ended = snapshot.outcome !== "running";
  const sessionKeyReady = apiKey.startsWith("sk-or-") && apiKey.length >= 24;
  const providerReady = configured || sessionKeyReady;
  const editableAgent = snapshot.agents.find((a) => a.id === contextAgent)!;
  const speechSupported = "speechSynthesis" in window;
  return (
    <main className="app">
      <div className="world">
        <WorldView
          world={snapshot}
          selected={selected}
          onSelect={choose}
          cameraReset={cameraReset}
        />
      </div>
      <header className="brand">
        <div className="brand-mark">
          <Leaf size={21} />
        </div>
        <div>
          <div className="brand-name">
            SIM <span>PROJ1</span>
            <span className="alpha">PROTOTYPE 01</span>
          </div>
          <div className="eyebrow">FIELD STATION / OBSERVER MODE</div>
        </div>
      </header>
      <div className="session">
        <span className={"connection-dot " + (mode === "live" ? "live" : "")} />
        <span>{mode === "live" ? "OPENROUTER" : "LOCAL SIMULATION"}</span>
        <button
          className="icon-button"
          title="Connection settings"
          aria-label="Connection settings"
          onClick={() => toggle("settings")}
        >
          <Settings2 size={16} />
        </button>
      </div>
      <section className="mission">
        <div className="mission-top">
          <span className="mission-icon">
            <Radio size={20} />
          </span>
          <div>
            <div className="eyebrow">SHARED OBJECTIVE</div>
            <h1>{snapshot.instance.objective}</h1>
          </div>
        </div>
        <div className="mission-progress">
          <div style={{ width: `${snapshot.repair}%` }} />
        </div>
        <div className="mission-meta">
          <span>UPLINK REPAIR</span>
          <strong>
            {Math.floor(snapshot.repair)}
            <small>%</small>
          </strong>
          <span className="deadline">
            <Sun size={13} /> BEFORE {clock(snapshot.instance.duration)}
          </span>
        </div>
      </section>
      <aside className="world-stamp">
        <span className="eyebrow">{snapshot.instance.title}</span>
        <span className="station-name">{snapshot.instance.premise}</span>
        <span className="stamp-rule" />
        <span className="eyebrow">
          3 CHARACTERS · {snapshot.instance.biome.toUpperCase()} ·{" "}
          {snapshot.instance.layout.toUpperCase()}
        </span>
      </aside>
      <div className="compass">
        <Compass size={28} strokeWidth={1} />
        <span>N</span>
      </div>
      <nav className="tool-dock" aria-label="Observer tools">
        <button
          className={panel === "agents" ? "active" : ""}
          onClick={() => toggle("agents")}
        >
          <Users size={18} />
          <span>Characters</span>
          <b>03</b>
        </button>
        <button
          className={panel === "intervene" ? "active" : ""}
          onClick={() => toggle("intervene")}
        >
          <Plus size={19} />
          <span>Intervene</span>
        </button>
        <button
          className={panel === "journal" ? "active" : ""}
          onClick={() => toggle("journal")}
        >
          <Activity size={18} />
          <span>Event journal</span>
          <i className="tiny-dot" />
        </button>
      </nav>
      <div className="time-dock">
        <div className="day">
          <span className="eyebrow">DAY 01</span>
          <strong>{clock(snapshot.time)}</strong>
        </div>
        <span className="dock-divider" />
        <button
          className="icon-button play"
          onClick={() => setPaused((v) => !v)}
          aria-label={paused ? "Resume simulation" : "Pause simulation"}
          disabled={ended}
        >
          {paused ? <Play size={18} /> : <Pause size={18} />}
        </button>
        <div className="speed-group">
          {[1, 2, 4].map((s) => (
            <button
              key={s}
              className={speed === s ? "active" : ""}
              onClick={() => setSpeed(s)}
              aria-label={`Speed ${s}x`}
            >
              {s}×
            </button>
          ))}
        </div>
        <span className="dock-divider" />
        <span className="weather">
          {snapshot.storm ? <CloudLightning size={18} /> : <Sun size={18} />}
          <span>{snapshot.storm ? "Storm" : "Clear skies"}</span>
        </span>
      </div>
      <div className="camera-hint">
        Drag to orbit <span>·</span> Scroll to explore
      </div>
      <button
        className="camera-reset"
        aria-label="Reset camera"
        title="Reset camera (R)"
        onClick={() => setCameraReset((v) => v + 1)}
      >
        <Crosshair size={18} />
      </button>
      <div className="world-status">
        <span className="tiny-dot" />
        <span>
          {ended
            ? "EXPERIMENT COMPLETE"
            : paused
              ? "SIMULATION PAUSED"
              : thinking
                ? `${snapshot.agents.find((a) => a.id === thinking)?.name.toUpperCase()} IS DECIDING…`
                : "WORLD IS RUNNING"}
        </span>
        <span className="status-separator">/</span>
        <span>{snapshot.supplies} FOOD IN STORAGE</span>
      </div>
      {panel && (
        <aside
          className="panel"
          aria-label={
            panel === "agents"
              ? "Characters panel"
              : panel === "intervene"
                ? "Intervention panel"
                : panel === "journal"
                  ? "Event journal"
                  : "Settings panel"
          }
        >
          <div className="panel-top">
            <span className="eyebrow">
              {panel === "agents"
                ? "THE PEOPLE OF STATION 01"
                : panel === "intervene"
                  ? "A SMALL CHANGE CAN MATTER"
                  : panel === "journal"
                    ? "THE STORY SO FAR"
                    : "EXPERIMENT SETTINGS"}
            </span>
            <button
              className="icon-button"
              aria-label="Close panel"
              onClick={() => setPanel(null)}
            >
              <X size={18} />
            </button>
          </div>
          {panel === "agents" && (
            <>
              <h2>{agent ? agent.name : "Meet the crew."}</h2>
              {!agent ? (
                <>
                  <p className="muted intro">
                    Different intentions. A common destination. Select a
                    character to see their world.
                  </p>
                  <div className="crew-list">
                    {snapshot.agents.map((a) => (
                      <button
                        key={a.id}
                        className="crew-card"
                        onClick={() => setSelected(a.id)}
                      >
                        <span
                          className="avatar"
                          style={{ background: a.color }}
                        >
                          {a.name[0]}
                        </span>
                        <span>
                          <strong>{a.name}</strong>
                          <small>{a.role}</small>
                          <em>
                            {thinking === a.id ? "Thinking…" : a.activity}
                          </em>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </div>
                  <div className="note">
                    <Users size={16} />
                    <span>Click a character in the world to inspect them.</span>
                  </div>
                </>
              ) : (
                <>
                  <button
                    className="text-button back"
                    onClick={() => setSelected(null)}
                  >
                    ← All characters
                  </button>
                  <div className="identity">
                    <span
                      className="avatar large"
                      style={{ background: agent.color }}
                    >
                      {agent.name[0]}
                    </span>
                    <div>
                      <span className="eyebrow">{agent.role}</span>
                      <p>{agent.activity}</p>
                    </div>
                  </div>
                  <div className="vitals">
                    <label>
                      Health <strong>{Math.round(agent.health)}%</strong>
                    </label>
                    <div className="meter health">
                      <i style={{ width: `${agent.health}%` }} />
                    </div>
                    <label>
                      Energy <strong>{Math.round(agent.energy)}%</strong>
                    </label>
                    <div className="meter">
                      <i style={{ width: `${agent.energy}%` }} />
                    </div>
                    <label>
                      Hunger <strong>{Math.round(agent.hunger)}%</strong>
                    </label>
                    <div className="meter hunger">
                      <i style={{ width: `${agent.hunger}%` }} />
                    </div>
                    <small>
                      {agent.food} carried food portion
                      {agent.food === 1 ? "" : "s"}
                    </small>
                  </div>
                  <div className="thought">
                    <span className="eyebrow">CURRENT INTENTION</span>
                    <p>“{agent.intent}”</p>
                    <span className="micro">
                      {mode === "local"
                        ? "Local behavior · no model connected"
                        : "Model decisions with local fallback"}
                    </span>
                  </div>
                  <details>
                    <summary>Personality & goal</summary>
                    <p>{agent.personality}</p>
                    <p>{agent.goal}</p>
                  </details>
                  <details>
                    <summary>Relationships</summary>
                    {Object.entries(agent.relationships).map(([id, value]) => (
                      <div className="relation" key={id}>
                        <span>
                          {snapshot.agents.find((a) => a.id === id)?.name}
                        </span>
                        <span>
                          {value >= 50
                            ? "Trusted"
                            : value >= 20
                              ? "Warming up"
                              : "Acquaintance"}{" "}
                          · {value}
                        </span>
                      </div>
                    ))}
                  </details>
                  <details>
                    <summary>
                      Recent memories <small>{agent.memories.length}</small>
                    </summary>
                    <ul className="memories">
                      {agent.memories
                        .slice(-6)
                        .reverse()
                        .map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                    </ul>
                  </details>
                  <section
                    className="chat-interface"
                    aria-label={`Chat with ${agent.name}`}
                  >
                    <div className="chat-header">
                      <span>
                        <MessageSquare size={14} /> Conversation
                      </span>
                      <small>{agent.chatHistory.length}/50 messages</small>
                    </div>
                    <div className="chat-thread" aria-live="polite">
                      {agent.chatHistory.length === 0 && (
                        <p className="chat-empty">
                          Start a conversation. What you say becomes part of{" "}
                          {agent.name}’s memory and future model context.
                        </p>
                      )}
                      {agent.chatHistory.map((entry) => (
                        <div
                          key={entry.id}
                          className={`chat-message ${entry.role}`}
                        >
                          <span>
                            {entry.role === "observer" ? "You" : agent.name}
                          </span>
                          <p>{entry.text}</p>
                          <time>{clock(entry.time)}</time>
                        </div>
                      ))}
                      {agent.inbox && (
                        <div className="chat-typing">
                          {agent.name} is considering your message…
                        </div>
                      )}
                      <div ref={chatEnd} />
                    </div>
                    <form
                      className="message-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        send();
                      }}
                    >
                      <label htmlFor="message">
                        MESSAGE {agent.name.toUpperCase()}
                      </label>
                      <div>
                        <input
                          id="message"
                          value={message}
                          maxLength={400}
                          onChange={(e) => setMessage(e.target.value)}
                          placeholder="Write a message…"
                          disabled={ended || !!agent.inbox}
                        />
                        <button
                          className="icon-button"
                          aria-label="Send message"
                          disabled={!message.trim() || ended || !!agent.inbox}
                        >
                          <Send size={17} />
                        </button>
                      </div>
                      <span className="micro">
                        {mode === "local"
                          ? "Local replies use rules; your message still updates memory and behavior."
                          : "OpenRouter receives recent chat, personality, memories, and world context."}
                      </span>
                    </form>
                  </section>
                </>
              )}
            </>
          )}
          {panel === "intervene" && (
            <>
              <h2>A little influence.</h2>
              <p className="muted intro">
                You’re the observer. Change the conditions, then see what
                unfolds.
              </p>
              <button
                className="intervention"
                onClick={() => intervention("food")}
                disabled={ended}
              >
                <span className="action-symbol">
                  <Plus size={23} />
                </span>
                <span>
                  <strong>Deliver supplies</strong>
                  <small>Add 4 food portions to storage.</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
              <button
                className="intervention"
                onClick={() => intervention(snapshot.storm ? "calm" : "storm")}
                disabled={ended}
              >
                <span className="action-symbol">
                  {snapshot.storm ? (
                    <Sun size={23} />
                  ) : (
                    <CloudLightning size={23} />
                  )}
                </span>
                <span>
                  <strong>
                    {snapshot.storm ? "Clear the skies" : "Bring in a storm"}
                  </strong>
                  <small>
                    {snapshot.storm
                      ? "Restore normal travel and repairs."
                      : "Slow movement and outdoor work."}
                  </small>
                </span>
                <ArrowUpRight size={18} />
              </button>
              <button
                className="intervention"
                onClick={() => {
                  setPanel("agents");
                  setSelected(null);
                }}
                disabled={ended}
              >
                <span className="action-symbol">
                  <MessageSquare size={23} />
                </span>
                <span>
                  <strong>Start a conversation</strong>
                  <small>Choose someone to speak with.</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
              <div className="note">
                <Leaf size={18} />
                <span>
                  Interventions change the world. Characters keep their own
                  goals and decide how to respond.
                </span>
              </div>
            </>
          )}
          {panel === "journal" && (
            <>
              <h2>Life, unfolding.</h2>
              <p className="muted intro">
                Conversations, small decisions, and the things that change the
                day.
              </p>
              <div className="journal">
                {snapshot.events.map((e) => (
                  <div key={e.id} className={"event " + e.kind}>
                    <span className="event-time">{clock(e.time)}</span>
                    <span className="event-line">
                      <i />
                      <p>{e.text}</p>
                    </span>
                  </div>
                ))}
                <div ref={lastEvent} />
              </div>
            </>
          )}
          {panel === "settings" && (
            <>
              <h2>Behind the world.</h2>
              <div className="setting-block">
                <span className="eyebrow">CREATE AN INSTANCE WITH AI</span>
                <label htmlFor="world-prompt">World description</label>
                <textarea
                  id="world-prompt"
                  className="settings-textarea"
                  value={worldPrompt}
                  maxLength={1200}
                  rows={5}
                  onChange={(e) => setWorldPrompt(e.target.value)}
                  placeholder="Describe the place, situation, objective, atmosphere, and constraints…"
                />
                <button
                  className="generate-world"
                  disabled={
                    !providerReady ||
                    worldPrompt.trim().length < 10 ||
                    generatingWorld
                  }
                  onClick={() => void generateWorld()}
                >
                  <Sparkles size={16} />
                  {generatingWorld
                    ? "Creating instance…"
                    : "Create new instance"}
                </button>
                <button
                  className="settings-save"
                  onClick={() => saveSettings("World prompt saved.")}
                >
                  <Save size={15} /> Save world prompt
                </button>
                <p className="micro">
                  The model creates a validated plan using one of three compact
                  layouts and biomes. Creating it starts a new paused world and
                  replaces unsaved progress.
                </p>
              </div>
              <div className="setting-block">
                <span className="eyebrow">CHARACTER INTELLIGENCE</span>
                <div className="mode-switch">
                  <button
                    className={mode === "local" ? "active" : ""}
                    onClick={() => {
                      setMode("local");
                      setAiError("");
                    }}
                  >
                    Local simulation
                  </button>
                  <button
                    className={mode === "live" ? "active" : ""}
                    onClick={() => setMode("live")}
                    disabled={!providerReady}
                  >
                    OpenRouter
                  </button>
                </div>
                <p className="muted">
                  {configured
                    ? "Server key detected. You can also enter a session key below to use it instead."
                    : sessionKeyReady
                      ? "Session key ready. OpenRouter mode can now make model decisions."
                      : "Local mode is ready. Enter an OpenRouter key below to enable live AI."}
                </p>
                <label htmlFor="openrouter-key">OpenRouter API key</label>
                <div className="credential-field">
                  <input
                    id="openrouter-key"
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    maxLength={512}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(e) => updateApiKey(e.target.value)}
                    placeholder="sk-or-v1-…"
                    aria-describedby="openrouter-key-help"
                  />
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setShowApiKey((visible) => !visible)}
                    aria-label={showApiKey ? "Hide API key" : "Show API key"}
                  >
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  {apiKey && (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => {
                        updateApiKey("");
                        setShowApiKey(false);
                        notify("OpenRouter session key cleared.");
                      }}
                      aria-label="Clear API key"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                <div
                  id="openrouter-key-help"
                  className={
                    "credential-status " + (sessionKeyReady ? "ready" : "")
                  }
                >
                  <span className="connection-dot" />
                  <span>
                    {sessionKeyReady
                      ? "Stored only for this browser tab session"
                      : apiKey
                        ? "Key should begin with sk-or-"
                        : configured
                          ? "Using the key configured on the server"
                          : "No key connected"}
                  </span>
                </div>
                <div className="catalog-heading">
                  <span className="eyebrow">AVAILABLE OPENROUTER MODELS</span>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Refresh OpenRouter models"
                    title="Refresh model catalog"
                    onClick={() => setCatalogRefresh((value) => value + 1)}
                    disabled={modelsLoading}
                  >
                    <RefreshCw size={15} />
                  </button>
                </div>
                {modelsError && <p className="inline-error">{modelsError}</p>}
                <ModelPicker
                  kind="free"
                  models={models}
                  selected={model}
                  loading={modelsLoading}
                  onSelect={chooseModel}
                />
                <ModelPicker
                  kind="paid"
                  models={models}
                  selected={model}
                  loading={modelsLoading}
                  onSelect={chooseModel}
                />
                <label htmlFor="model">Selected model ID</label>
                <input
                  id="model"
                  value={model}
                  maxLength={120}
                  onChange={(event) => {
                    generation.current++;
                    setModel(event.target.value);
                    setConnectionTest({ state: "idle", text: "" });
                  }}
                  placeholder="provider/model"
                />
                {model === "openrouter/free" && (
                  <p className="model-warning">
                    <strong>Choose a specific free model.</strong> The automatic
                    OpenRouter free router can switch models between calls and
                    may not return valid simulation actions.
                  </p>
                )}
                <div className="connection-actions">
                  <button
                    className="test-connection"
                    onClick={() => void testConnection()}
                    disabled={
                      !providerReady || connectionTest.state === "testing"
                    }
                  >
                    <Wifi size={15} />
                    {connectionTest.state === "testing"
                      ? "Testing…"
                      : "Test selected model"}
                  </button>
                  <button
                    className="settings-save"
                    onClick={() =>
                      saveSettings("OpenRouter model setting saved.")
                    }
                  >
                    <Save size={15} /> Save connection settings
                  </button>
                </div>
                {connectionTest.state !== "idle" && (
                  <p
                    className={`connection-test-result ${connectionTest.state}`}
                    role="status"
                  >
                    {connectionTest.text}
                  </p>
                )}
                <p className="micro">
                  The live catalog refreshes from OpenRouter and only includes
                  models advertising JSON response support. Prices are shown per
                  million tokens. Live mode makes at most one decision every 8
                  seconds and 120 requests/hour. Session keys are never included
                  in saves or exports.
                </p>
                {aiError && (
                  <p className="inline-error" role="alert">
                    {aiError}
                  </p>
                )}
              </div>
              <div className="setting-block">
                <span className="eyebrow">WORLD & CHARACTER CONTEXT</span>
                <label htmlFor="situation-context">Current situation</label>
                <textarea
                  id="situation-context"
                  className="settings-textarea"
                  value={snapshot.instance.situation}
                  maxLength={600}
                  rows={4}
                  onChange={(e) => updateSituation(e.target.value)}
                />
                <label htmlFor="context-character">Character</label>
                <select
                  id="context-character"
                  value={contextAgent}
                  onChange={(e) => setContextAgent(e.target.value)}
                >
                  {snapshot.agents.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.name}
                    </option>
                  ))}
                </select>
                <label htmlFor="personality-context">Personality/context</label>
                <textarea
                  id="personality-context"
                  className="settings-textarea"
                  value={editableAgent.personality}
                  maxLength={500}
                  rows={4}
                  onChange={(e) =>
                    updateCharacter(
                      editableAgent.id,
                      "personality",
                      e.target.value,
                    )
                  }
                />
                <label htmlFor="goal-context">Goal</label>
                <textarea
                  id="goal-context"
                  className="settings-textarea"
                  value={editableAgent.goal}
                  maxLength={300}
                  rows={3}
                  onChange={(e) =>
                    updateCharacter(editableAgent.id, "goal", e.target.value)
                  }
                />
                <div className="memory-heading">
                  <label htmlFor="memory-context">Memories, one per line</label>
                  <label htmlFor="memory-limit">
                    Limit
                    <input
                      id="memory-limit"
                      type="number"
                      min={4}
                      max={30}
                      value={editableAgent.memoryLimit}
                      onChange={(e) =>
                        updateCharacter(
                          editableAgent.id,
                          "memoryLimit",
                          e.target.value,
                        )
                      }
                    />
                  </label>
                </div>
                <textarea
                  id="memory-context"
                  className="settings-textarea memories-editor"
                  value={editableAgent.memories.join("\n")}
                  rows={7}
                  onChange={(e) =>
                    updateCharacter(
                      editableAgent.id,
                      "memories",
                      e.target.value,
                    )
                  }
                />
                <p className="micro">
                  Changes apply immediately and are included in local choices,
                  model observations, saves, and exports.
                </p>
                <button
                  className="settings-save"
                  onClick={() =>
                    saveSettings("World and character context saved.", true)
                  }
                >
                  <Save size={15} /> Save world &amp; character context
                </button>
              </div>
              <div className="setting-block">
                <span className="eyebrow">REAL-TIME CHARACTER VOICES</span>
                {speechSupported ? (
                  <>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={voiceSettings.enabled}
                        onChange={(e) =>
                          setVoiceSettings((current) => ({
                            ...current,
                            enabled: e.target.checked,
                          }))
                        }
                      />
                      <Volume2 size={16} /> Speak new dialogue aloud
                    </label>
                    <label htmlFor="voice-rate">
                      Speech rate · {voiceSettings.rate.toFixed(1)}×
                    </label>
                    <input
                      id="voice-rate"
                      type="range"
                      min="0.7"
                      max="1.4"
                      step="0.1"
                      value={voiceSettings.rate}
                      onChange={(e) =>
                        setVoiceSettings((current) => ({
                          ...current,
                          rate: Number(e.target.value),
                        }))
                      }
                    />
                    {snapshot.agents.map((character) => (
                      <div className="voice-row" key={character.id}>
                        <label htmlFor={`voice-${character.id}`}>
                          {character.name}
                        </label>
                        <select
                          id={`voice-${character.id}`}
                          value={voiceSettings.voices[character.id] || ""}
                          onChange={(e) =>
                            setVoiceSettings((current) => ({
                              ...current,
                              voices: {
                                ...current.voices,
                                [character.id]: e.target.value,
                              },
                            }))
                          }
                        >
                          <option value="">Browser default</option>
                          {availableVoices.map((voice) => (
                            <option
                              key={`${voice.name}-${voice.lang}`}
                              value={voice.name}
                            >
                              {voice.name} · {voice.lang}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                    <p className="micro">
                      Uses the browser’s built-in speech synthesis immediately
                      when a dialogue bubble appears. Available voices depend on
                      Windows and your browser; this uses no model credits.
                    </p>
                    <button
                      className="settings-save"
                      onClick={() => saveSettings("Voice settings saved.")}
                    >
                      <Save size={15} /> Save voice settings
                    </button>
                  </>
                ) : (
                  <p className="muted">
                    This browser does not provide real-time speech synthesis.
                  </p>
                )}
              </div>
              <div className="setting-block">
                <span className="eyebrow">KEEP YOUR EXPERIMENT</span>
                <div className="save-actions">
                  <button onClick={save}>
                    <Download size={15} />
                    Save locally
                  </button>
                  <button onClick={load} disabled={!saveExists}>
                    <RotateCcw size={15} />
                    Load save
                  </button>
                  <button onClick={exportSave}>
                    <ArrowUpRight size={15} />
                    Export JSON
                  </button>
                  <button onClick={() => fileInput.current?.click()}>
                    <Upload size={15} />
                    Import JSON
                  </button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(e) => {
                    void importSave(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <p className="micro">
                  Local saves stay in this browser. Export a file to keep a
                  portable copy.
                </p>
              </div>
              <div className="setting-block">
                <span className="eyebrow">START AGAIN</span>
                {resetConfirm ? (
                  <div className="confirm">
                    <p>Reset this world? Unsaved progress will be lost.</p>
                    <button onClick={reset}>Yes, start a new day</button>
                    <button onClick={() => setResetConfirm(false)}>
                      Keep this world
                    </button>
                  </div>
                ) : (
                  <button
                    className="reset-experiment"
                    onClick={() => setResetConfirm(true)}
                  >
                    <RotateCcw size={16} />
                    Reset experiment
                  </button>
                )}
              </div>
              <p className="micro">
                Space to pause · R to reset camera · Esc to close panels.
                <br />
                Procedural art · no external assets required.
              </p>
            </>
          )}
        </aside>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {aiError && mode === "live" && panel !== "settings" && (
        <button className="ai-warning" onClick={() => setPanel("settings")}>
          AI unavailable · local behavior continues <ChevronRight size={14} />
        </button>
      )}
      {ended && !resultHidden && (
        <div className="outcome" role="dialog" aria-label="Experiment result">
          <span className="outcome-icon">
            {snapshot.outcome === "success" ? (
              <Radio size={30} />
            ) : (
              <Flag size={30} />
            )}
          </span>
          <div className="eyebrow">DAY 01 / EXPERIMENT COMPLETE</div>
          <h2>
            {snapshot.outcome === "success"
              ? "A signal. A way forward."
              : "Night falls on the station."}
          </h2>
          <p>
            {snapshot.outcome === "success"
              ? "The crew restored the uplink. Their choices, and your interventions, made a difference."
              : `The uplink reached ${Math.floor(snapshot.repair)}%. Try a new approach: protect their energy, share supplies, or give them clearer guidance.`}
          </p>
          <div>
            <button
              onClick={() => {
                setResultHidden(true);
                setPanel("journal");
                setPaused(true);
              }}
            >
              Read the journal
            </button>
            <button className="primary" onClick={reset}>
              Start a new day <ArrowUpRight size={16} />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
