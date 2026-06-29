import { useState } from "react";
import { fmtDate, fmtTime, sentimentEmoji } from "./lib.js";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = "January February March April May June July August September October November December".split(
  " "
);
const keyOf = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
};

export default function Calendar({ entries, onOpen }) {
  const latest = entries[0]?.recordedAt || Date.now();
  const [cursor, setCursor] = useState(() => {
    const d = new Date(latest);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [selected, setSelected] = useState(null);

  // Bucket entries by day.
  const byDay = {};
  for (const e of entries) {
    (byDay[keyOf(e.recordedAt)] ||= []).push(e);
  }
  const maxInDay = Math.max(1, ...Object.values(byDay).map((a) => a.length));

  const first = new Date(cursor.y, cursor.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const move = (delta) =>
    setCursor(({ y, m }) => {
      const nm = m + delta;
      return { y: y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
    });

  const selDay = selected
    ? byDay[`${cursor.y}-${cursor.m}-${selected}`] || []
    : [];

  return (
    <div className="cal-overlay">
      <h2 className="view-title">Calendar</h2>
      <p className="view-sub">Your activity, day by day.</p>

      <div className="cal-wrap">
        <div className="cal glass">
          <div className="cal-head">
            <button className="btn ghost sq" onClick={() => move(-1)}>◂</button>
            <h3>{MONTHS[cursor.m]} <span>{cursor.y}</span></h3>
            <button className="btn ghost sq" onClick={() => move(1)}>▸</button>
          </div>
          <div className="cal-grid cal-dow">
            {DOW.map((d, i) => (
              <span key={i} className="cal-dowcell">{d}</span>
            ))}
          </div>
          <div className="cal-grid">
            {cells.map((d, i) => {
              if (!d) return <span key={i} className="cal-cell empty" />;
              const items = byDay[`${cursor.y}-${cursor.m}-${d}`] || [];
              const intensity = items.length / maxInDay;
              const isSel = selected === d;
              return (
                <button
                  key={i}
                  className={`cal-cell ${items.length ? "has" : ""} ${isSel ? "sel" : ""}`}
                  style={items.length ? { "--i": 0.25 + intensity * 0.75 } : {}}
                  onClick={() => setSelected(items.length ? d : null)}
                >
                  <span className="cal-num">{d}</span>
                  {items.length > 0 && <span className="cal-count">{items.length}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="cal-day glass">
          <h3>{selected ? `${MONTHS[cursor.m]} ${selected}` : "Pick a day"}</h3>
          {selDay.length === 0 ? (
            <p className="muted">{selected ? "No moments this day." : "Click a marked day."}</p>
          ) : (
            <ul className="day-list">
              {selDay.map((e) => {
                const ready = e.status === "ready" && e.analysis;
                return (
                  <li key={e._id}>
                    <button className="day-item" onClick={() => ready && onOpen(e)} disabled={!ready}>
                      <span className="day-time">{fmtTime(e.recordedAt)}</span>
                      <span className="day-title">{e.title || "Untitled moment"}</span>
                      {e.analysis && <span className="day-mood">{sentimentEmoji(e.analysis.sentiment)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
