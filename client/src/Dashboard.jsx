import { aggregateLife, recommendTasks, moodLabel } from "./lib.js";

const ARC_ARROW = { rising: "↗", falling: "↘", flat: "→" };

export default function Dashboard({ entries, onOpen, onGoRecord }) {
  const { domains, avg, topArc, total } = aggregateLife(entries);
  const tasks = recommendTasks(entries);

  return (
    <div className="dash-overlay">
      <div className="dash-head">
        <h1>
          Your life<span>.</span>
        </h1>
        {total > 0 ? (
          <div className="cinema-meta">
            <span><b>{total}</b> moments</span>
            <span><b>{moodLabel(avg)}</b> mood</span>
            <span><b>{ARC_ARROW[topArc] || "→"} {topArc || "steady"}</b></span>
          </div>
        ) : (
          <p className="cinema-empty">Record your first moment to bring this to life.</p>
        )}
      </div>

      {domains.length > 0 ? (
        <div className="dash-sections">
          {domains.map(({ domain, notes }) => (
            <button key={domain} className="dash-sec glass" onClick={() => onOpen(notes[0].entry)}>
              <span className="cs-domain">{domain}</span>
              <span className="cs-status">{notes[0].status}</span>
              <span className="cs-count">{notes.length}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="dash-cta">
          <button className="btn accent big" onClick={onGoRecord}>● Record a moment</button>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="dash-tasks">
          <span className="dash-task-count">{tasks.length} recommended tasks</span>
        </div>
      )}

      <p className="dash-hint">click a section to read · navigate with the bar above</p>
    </div>
  );
}
