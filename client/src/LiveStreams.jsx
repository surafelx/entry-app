import { useState, useEffect } from "react";
import { listLiveKitRooms, createLiveKitRoom } from "./api.js";
import LivestreamRoom from "./LivestreamRoom.jsx";

export default function LiveStreams() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeRoom, setActiveRoom] = useState(null);
  const [streamerMode, setStreamerMode] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");

  const loadRooms = async () => {
    try {
      const data = await listLiveKitRooms();
      setRooms(Array.isArray(data) ? data : []);
    } catch { setRooms([]); }
    setLoading(false);
  };

  useEffect(() => {
    loadRooms();
    const interval = setInterval(loadRooms, 10000);
    return () => clearInterval(interval);
  }, []);

  const goLive = async () => {
    const name = newRoomName.trim() || `stream-${Date.now()}`;
    try {
      await createLiveKitRoom(name);
      setActiveRoom(name);
      setStreamerMode(true);
      setNewRoomName("");
    } catch (e) { alert("Failed to create room: " + e.message); }
  };

  if (activeRoom) {
    return (
      <LivestreamRoom
        roomName={activeRoom}
        mode={streamerMode ? "streamer" : "viewer"}
        userName="User"
        onEnd={() => { setActiveRoom(null); loadRooms(); }}
      />
    );
  }

  return (
    <div className="streams-overlay">
      <h2 className="view-title">Live Streams</h2>
      <p className="view-sub">{rooms.length} active stream{rooms.length !== 1 ? "s" : ""}</p>

      <div className="go-live-bar">
        <input
          className="title-in glass"
          placeholder="Stream title (optional)"
          value={newRoomName}
          onChange={(e) => setNewRoomName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && goLive()}
        />
        <button className="btn accent" onClick={goLive}>● Go Live</button>
      </div>

      {loading ? (
        <p className="muted">Loading streams...</p>
      ) : rooms.length === 0 ? (
        <div className="streams-empty">
          <p>No active streams</p>
          <p className="muted">Start a livestream to see it here</p>
        </div>
      ) : (
        <div className="streams-grid">
          {rooms.map((room) => (
            <article key={room.name} className="stream-card glass" onClick={() => { setActiveRoom(room.name); setStreamerMode(false); }}>
              <div className="sc-preview">
                <span className="live-badge">LIVE</span>
                <span className="sc-participants">{room.participants || 0} watching</span>
              </div>
              <div className="sc-info">
                <h3>{room.name}</h3>
                <p>{room.numParticipants || 0} participants</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
