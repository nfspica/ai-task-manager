import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

const PRIORITY_CONFIG = {
  high:   { label: "高", color: "#C0392B", bg: "#FDEDEC", dot: "#E74C3C" },
  medium: { label: "中", color: "#B7770D", bg: "#FEF9E7", dot: "#F39C12" },
  low:    { label: "低", color: "#1A5276", bg: "#EBF5FB", dot: "#2E86C1" },
  none:   { label: "未設定", color: "#555", bg: "#F4F4F4", dot: "#AAA" },
};

function PriorityBadge({ priority }) {
  const c = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.none;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
      color: c.color, background: c.bg,
      padding: "2px 9px", borderRadius: 99,
      border: `1px solid ${c.color}22`,
      whiteSpace: "nowrap",
    }}>{c.label}</span>
  );
}

function TaskCard({ task, onToggle, onDelete }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 12,
      padding: "14px 16px",
      background: task.done ? "#FAFAFA" : "#fff",
      borderRadius: 10,
      border: "1px solid #EDEDED",
      transition: "opacity 0.2s",
      opacity: task.done ? 0.55 : 1,
    }}>
      <button
        onClick={() => onToggle(task.id, task.done)}
        style={{
          marginTop: 2, width: 20, height: 20, minWidth: 20,
          borderRadius: "50%", border: `2px solid ${task.done ? "#2ECC71" : "#CCC"}`,
          background: task.done ? "#2ECC71" : "transparent",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s",
        }}
      >
        {task.done && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.8 7L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 15, fontWeight: 500,
            color: task.done ? "#AAA" : "#1A1A1A",
            textDecoration: task.done ? "line-through" : "none",
            wordBreak: "break-word",
          }}>{task.title}</span>
          <PriorityBadge priority={task.priority} />
        </div>
        {task.note && (
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888", lineHeight: 1.5 }}>{task.note}</p>
        )}
      </div>
      <button
        onClick={() => onDelete(task.id)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "#CCC", fontSize: 18, lineHeight: 1, padding: "0 2px",
          transition: "color 0.15s",
        }}
        onMouseEnter={e => e.currentTarget.style.color = "#E74C3C"}
        onMouseLeave={e => e.currentTarget.style.color = "#CCC"}
        aria-label="削除"
      >×</button>
    </div>
  );
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [aiStatus, setAiStatus] = useState("");
  const [filter, setFilter] = useState("all");

  // 起動時にSupabaseからタスクを取得
  useEffect(() => {
    const fetchTasks = async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error) setTasks(data);
      setFetching(false);
    };
    fetchTasks();
  }, []);

  // タスク追加
  const addTask = async () => {
    const title = input.trim();
    if (!title) return;
    const { data, error } = await supabase
      .from("tasks")
      .insert([{ title, priority: "none", done: false, note: "" }])
      .select();
    if (!error) setTasks(prev => [data[0], ...prev]);
    setInput("");
  };

  // 完了トグル
  const toggleTask = async (id, currentDone) => {
    const { error } = await supabase
      .from("tasks")
      .update({ done: !currentDone })
      .eq("id", id);
    if (!error) setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  // タスク削除
  const deleteTask = async (id) => {
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", id);
    if (!error) setTasks(prev => prev.filter(t => t.id !== id));
  };

  // AI優先度分析
  const analyzeAll = async () => {
    const active = tasks.filter(t => !t.done);
    if (active.length === 0) return;
    setLoading(true);
    setAiStatus("analyzing");

    const prompt = `あなたはタスク管理のAIアシスタントです。
以下のタスクリストを見て、各タスクの優先度を「high」「medium」「low」のいずれかで判定してください。

タスクリスト:
${active.map(t => `- id:${t.id} "${t.title}"`).join("\n")}

以下のJSON形式のみで回答してください。余計な説明は不要です：
{"priorities": [{"id": "<id>", "priority": "high"|"medium"|"low", "reason": "<15字以内の理由>"}]}`;

    try {
      const res = await fetch("http://localhost:3001/api/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      // Supabaseを一括更新
      for (const p of parsed.priorities) {
        await supabase
          .from("tasks")
          .update({ priority: p.priority, note: p.reason })
          .eq("id", p.id);
      }

      const map = {};
      parsed.priorities.forEach(p => { map[p.id] = { priority: p.priority, note: p.reason }; });
      setTasks(prev => prev.map(t => map[t.id]
        ? { ...t, priority: map[t.id].priority, note: map[t.id].note }
        : t
      ));
      setAiStatus("done");
    } catch (e) {
      setAiStatus("error");
    } finally {
      setLoading(false);
      setTimeout(() => setAiStatus(""), 3000);
    }
  };

  const filtered = tasks.filter(t =>
    filter === "all" ? true : filter === "active" ? !t.done : t.done
  );
  const activeCount = tasks.filter(t => !t.done).length;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F7F7F5",
      fontFamily: "'DM Sans', 'Noto Sans JP', sans-serif",
      padding: "40px 16px",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#1A1A1A", letterSpacing: "-0.5px" }}>
            タスクマネージャー
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#888" }}>
            {fetching ? "読み込み中..." : `${activeCount}件のタスクが残っています`}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addTask()}
            placeholder="新しいタスクを入力..."
            style={{
              flex: 1, padding: "10px 14px",
              border: "1.5px solid #E0E0E0",
              borderRadius: 8, fontSize: 15,
              background: "#fff", outline: "none",
              fontFamily: "inherit", color: "#1A1A1A",
              transition: "border-color 0.15s",
            }}
            onFocus={e => e.target.style.borderColor = "#2E86C1"}
            onBlur={e => e.target.style.borderColor = "#E0E0E0"}
          />
          <button
            onClick={addTask}
            style={{
              padding: "10px 18px", borderRadius: 8,
              background: "#1A1A1A", color: "#fff",
              border: "none", fontWeight: 700, fontSize: 20,
              cursor: "pointer", transition: "opacity 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.8"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >+</button>
        </div>

        <button
          onClick={analyzeAll}
          disabled={loading || activeCount === 0}
          style={{
            width: "100%", padding: "11px 16px",
            borderRadius: 8, marginBottom: 24,
            background: loading ? "#EEE" : "#EBF5FB",
            border: `1.5px solid ${loading ? "#DDD" : "#2E86C1"}`,
            color: loading ? "#AAA" : "#1A5276",
            fontWeight: 700, fontSize: 14, cursor: loading ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: "all 0.15s", fontFamily: "inherit",
          }}
        >
          {loading ? (
            <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>AIが優先度を分析中...</>
          ) : aiStatus === "done" ? (
            <><span>✓</span>優先度を更新しました</>
          ) : aiStatus === "error" ? (
            <><span>⚠</span>エラーが発生しました</>
          ) : (
            <><span>✦</span>AIで優先度を自動提案</>
          )}
        </button>

        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {[["all","すべて"],["active","未完了"],["done","完了済み"]].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              style={{
                padding: "5px 14px", borderRadius: 99,
                border: "1px solid #E0E0E0",
                background: filter === val ? "#1A1A1A" : "#fff",
                color: filter === val ? "#fff" : "#666",
                fontSize: 12, fontWeight: 500, cursor: "pointer",
                fontFamily: "inherit", transition: "all 0.15s",
              }}
            >{label}</button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {fetching && (
            <div style={{ textAlign: "center", padding: "48px 0", color: "#BBB", fontSize: 14 }}>
              読み込み中...
            </div>
          )}
          {!fetching && filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 0", color: "#BBB", fontSize: 14 }}>
              タスクがありません
            </div>
          )}
          {filtered.map(task => (
            <TaskCard key={task.id} task={task} onToggle={toggleTask} onDelete={deleteTask} />
          ))}
        </div>

        <div style={{ marginTop: 28, padding: "12px 16px", background: "#fff", borderRadius: 10, border: "1px solid #EDEDED" }}>
          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.08em" }}>優先度の凡例</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {Object.entries(PRIORITY_CONFIG).map(([key, c]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot, display: "inline-block" }} />
                <span style={{ fontSize: 12, color: "#666" }}>{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
