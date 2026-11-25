import { useState, useMemo, useRef, useEffect } from "react";
import { TOPICS, QUESTION_TYPES, makeQuestion, checkAnswer } from "./quizEngine.js";
import "./quiz.css";

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

export default function Quiz() {
  const [topics, setTopics] = useState(Object.keys(TOPICS));
  const [only, setOnly]     = useState("");
  const [seed, setSeed]     = useState(newSeed);
  const [num, setNum]       = useState(1);
  const [input, setInput]   = useState("");
  const [picked, setPicked] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const inputRef = useRef(null);

  const q = useMemo(() => makeQuestion(seed, topics, only || null), [seed, topics, only]);
  const isChoice = q?.answer.type === "choice";
  const right = history.filter(h => h.correct).length;

  useEffect(() => { if (!result) inputRef.current?.focus(); }, [q, result]);

  function next() {
    setSeed(newSeed());
    setNum(n => n + 1);
    setInput(""); setPicked(null); setResult(null);
  }
  function submit() {
    if (!q || result) return;
    const answer = isChoice ? picked : input;
    if (answer === null || answer === "") return;
    const res = checkAnswer(q, answer);
    setResult(res);
    setHistory(h => [{ n:num, title:q.title, topic:q.topic, correct:res.correct }, ...h].slice(0, 40));
  }
  function toggleTopic(t) {
    setTopics(ts => {
      const nextTs = ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t];
      return nextTs.length ? nextTs : ts;
    });
    setOnly(""); setInput(""); setPicked(null); setResult(null);
  }

  const byTopic = Object.keys(TOPICS).map(t => {
    const hs = history.filter(h => h.topic === t);
    return { t, total:hs.length, right:hs.filter(h => h.correct).length };
  });

  return (
    <div className="qz">
      <div className="qz-main">
        {!q ? <div className="qz-card"><p>Pick at least one topic.</p></div> : (
          <div className="qz-card" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (result) next(); else submit(); } }}>
            <div className="qz-meta">
              <span>Question {num}</span>
              <span className={`qz-topic t-${q.topic}`}>{TOPICS[q.topic]}</span>
              <span>{q.title}</span>
            </div>
            <p className="qz-prompt">{q.prompt}</p>
            {q.table && (
              <table className="qz-table">
                <thead><tr>{q.table.cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{q.table.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
              </table>
            )}

            {isChoice ? (
              <div className="qz-choices" role="radiogroup" aria-label="Answer choices">
                {q.answer.choices.map((c, i) => {
                  const state = result ? (i === q.answer.correct ? "right" : i === picked ? "wrong" : "") : picked === i ? "picked" : "";
                  return (
                    <button key={i} role="radio" aria-checked={picked === i} className={`qz-choice ${state}`} disabled={!!result}
                      onClick={() => setPicked(i)}>
                      <span>{String.fromCharCode(65 + i)}</span>{c}
                    </button>
                  );
                })}
              </div>
            ) : (
              <label className="qz-answer">Your answer
                <input ref={inputRef} value={input} disabled={!!result} onChange={e => setInput(e.target.value)}
                  placeholder={q.answer.type === "ip" ? "e.g. 192.168.1.0" : q.answer.allowInfinity ? "a number, or ∞ / inf if not reachable yet" : "a number"}
                  inputMode={q.answer.type === "ip" || q.answer.allowInfinity ? "text" : "decimal"}/>
              </label>
            )}

            <div className="qz-actions">
              {!result
                ? <>
                    <button className="qz-go" onClick={submit} disabled={isChoice ? picked === null : !input.trim()}>Check answer</button>
                    <button className="qz-skip" onClick={next}>Skip</button>
                  </>
                : <button className="qz-go" onClick={next}>Next question →</button>}
            </div>

            {result && (
              <div className={`qz-result ${result.correct ? "ok" : "bad"}`} role="status">
                <div className="qz-verdict">{result.correct ? "✓ Correct" : `✗ Not quite — the answer is ${result.expected}`}</div>
                <div className="qz-worktitle">Working</div>
                <ol className="qz-work">{q.explain.map((line, i) => <li key={i}>{line}</li>)}</ol>
              </div>
            )}
          </div>
        )}
      </div>

      <aside className="qz-side">
        <div className="qz-card">
          <div className="qz-title">Score</div>
          <div className="qz-score">{right}<span> / {history.length}</span></div>
          {byTopic.filter(b => b.total).map(b => (
            <div key={b.t} className="qz-bar">
              <span>{TOPICS[b.t]}</span>
              <div><i style={{ width:`${(b.right / b.total) * 100}%` }}/></div>
              <b>{b.right}/{b.total}</b>
            </div>
          ))}
          {!history.length && <p className="qz-note">Answer a few questions to see your score by topic.</p>}
        </div>

        <div className="qz-card">
          <div className="qz-title">Topics</div>
          {Object.entries(TOPICS).map(([t, name]) => (
            <label key={t} className="qz-check">
              <input type="checkbox" checked={topics.includes(t)} onChange={() => toggleTopic(t)}/>{name}
            </label>
          ))}
          <label className="qz-field">Only this type
            <select value={only} onChange={e => { setOnly(e.target.value); setInput(""); setPicked(null); setResult(null); }}>
              <option value="">Any type</option>
              {QUESTION_TYPES.filter(t => topics.includes(t.topic)).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>
          <p className="qz-note">Every question uses new random numbers, and the answers come from the same simulators as the builder and transport lab.</p>
        </div>

        {history.length > 0 && (
          <div className="qz-card">
            <div className="qz-title">Recent</div>
            <ul className="qz-history">
              {history.slice(0, 10).map(h => <li key={h.n} className={h.correct ? "ok" : "bad"}>{h.correct ? "✓" : "✗"} {h.title}</li>)}
            </ul>
            <button className="qz-skip" onClick={() => setHistory([])}>Reset score</button>
          </div>
        )}
      </aside>
    </div>
  );
}
