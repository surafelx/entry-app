import { useState } from "react";
import ChatRoom from "./ChatRoom.jsx";

const PEOPLE = [
  { name: "Maya Okafor", handle: "mayao", streak: 41, moments: 128, mood: "Bright", focus: "Work & Craft", note: "Shipping a hardware demo this week.", color: "#FF4D2E", following: true },
  { name: "Theo Park", handle: "theop", streak: 12, moments: 54, mood: "Even", focus: "Mind & Growth", note: "Reading two books a week again.", color: "#4D5DFF", following: false },
  { name: "Lena Vask", handle: "lenav", streak: 88, moments: 301, mood: "Warm", focus: "Relationships", note: "Reconnected with an old friend.", color: "#111111", following: true },
  { name: "Dario Costa", handle: "dcosta", streak: 5, moments: 19, mood: "Low", focus: "Health & Body", note: "Back to running after an injury.", color: "#1FA66A", following: false },
  { name: "Priya N.", handle: "priyan", streak: 27, moments: 96, mood: "Bright", focus: "Play", note: "Started a pottery class on a whim.", color: "#E0A100", following: false },
  { name: "Sam Reyes", handle: "samr", streak: 63, moments: 210, mood: "Warm", focus: "Work & Craft", note: "Quietly building a side project.", color: "#8B3FE8", following: true },
];

const COMMUNITY_ROOM_ID = "community-general";

function initials(name) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("");
}

export default function Community() {
  const [people, setPeople] = useState(PEOPLE);
  const followingCount = people.filter((p) => p.following).length;

  const toggle = (handle) =>
    setPeople((prev) => prev.map((p) => p.handle === handle ? { ...p, following: !p.following } : p));

  return (
    <div className="community-overlay">
      <h2 className="view-title">Community</h2>
      <p className="view-sub">{people.length} people journaling out loud · following {followingCount}</p>

      <div className="community-layout">
        <div className="community-sidebar">
          {people.map((p) => (
            <article key={p.handle} className="person glass">
              <div className="person-top">
                <span className="avatar" style={{ background: p.color }}>{initials(p.name)}</span>
                <div className="person-id">
                  <h3>{p.name}</h3>
                  <span className="person-handle">@{p.handle}</span>
                </div>
                <button className={`follow ${p.following ? "on" : ""}`} onClick={() => toggle(p.handle)}>
                  {p.following ? "Following" : "Follow"}
                </button>
              </div>
              <p className="person-note">"{p.note}"</p>
              <div className="person-stats">
                <span><b>{p.streak}</b> streak</span>
                <span><b>{p.moments}</b> moments</span>
              </div>
              <div className="person-foot">
                <span className="person-mood">{p.mood}</span>
                <span className="person-focus">{p.focus}</span>
              </div>
            </article>
          ))}
        </div>

        <div className="community-chat-wrap glass">
          <ChatRoom roomId={COMMUNITY_ROOM_ID} roomName="General" userName="You" />
        </div>
      </div>
    </div>
  );
}
