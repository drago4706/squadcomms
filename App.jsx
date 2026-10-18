import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, createLocalAudioTrack } from 'livekit-client';
import { AudioLines, Copy, Headphones, Link2, Mic, MicOff, Radio, ShieldCheck, Users, Volume2, Wifi, X } from 'lucide-react';

const makeCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
};

export default function App() {
  const [screen, setScreen] = useState('home');
  const [displayName, setDisplayName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [draftCode, setDraftCode] = useState('');
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [ptt, setPtt] = useState(false);
  const [pttDown, setPttDown] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const roomRef = useRef(null);
  const localTrackRef = useRef(null);
  const joinedRef = useRef(false);

  const active = screen === 'room';
  const effectiveMuted = muted || deafened || (ptt && !pttDown);

  useEffect(() => {
    const handleDown = (e) => {
      if (e.code === 'Space' && ptt && active && !e.repeat && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault(); setPttDown(true);
      }
    };
    const handleUp = (e) => { if (e.code === 'Space') setPttDown(false); };
    window.addEventListener('keydown', handleDown);
    window.addEventListener('keyup', handleUp);
    window.addEventListener('blur', () => setPttDown(false));
    return () => {
      window.removeEventListener('keydown', handleDown);
      window.removeEventListener('keyup', handleUp);
    };
  }, [ptt, active]);

  useEffect(() => {
    if (localTrackRef.current) localTrackRef.current.mute(effectiveMuted).catch(() => {});
  }, [effectiveMuted]);

  useEffect(() => () => { disconnect(); }, []);

  async function joinRoom(code) {
    setError('');
    const name = displayName.trim();
    const normalized = String(code || '').trim().toUpperCase();
    if (!name) return setError('Enter a name so your squad knows who joined.');
    if (!/^[A-HJ-NP-Z2-9]{6,10}$/.test(normalized)) return setError('Enter a valid 6–10 character room code.');
    setBusy(true);
    try {
      const response = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: normalized, participantName: name })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not join this room.');

      const room = new Room({
        adaptiveStream: false,
        dynacast: false,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        publishDefaults: { audioPreset: undefined }
      });
      roomRef.current = room;

      room.on(RoomEvent.ParticipantConnected, refreshParticipants);
      room.on(RoomEvent.ParticipantDisconnected, refreshParticipants);
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const audioElement = track.attach();
          audioElement.autoplay = true;
          audioElement.dataset.squadcommsAudio = 'true';
          document.body.appendChild(audioElement);
          if (deafened) track.setVolume(0);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach(element => element.remove());
      });
      room.on(RoomEvent.ActiveSpeakersChanged, refreshParticipants);
      room.on(RoomEvent.Disconnected, () => {
        document.querySelectorAll('[data-squadcomms-audio="true"]').forEach(element => element.remove());
        setScreen('home'); setRoomCode(''); setParticipants([]);
      });

      await room.connect(data.serverUrl, data.participantToken, { autoSubscribe: true });
      const track = await createLocalAudioTrack({
        echoCancellation: true, noiseSuppression: true, autoGainControl: true
      });
      localTrackRef.current = track;
      await room.localParticipant.publishTrack(track);
      await track.mute(effectiveMuted);
      joinedRef.current = true;
      setRoomCode(normalized);
      setScreen('room');
      setParticipants([{
        identity: room.localParticipant.identity,
        name,
        local: true,
        speaking: false
      }, ...Array.from(room.remoteParticipants.values(), p => ({
        identity: p.identity, name: p.name || 'Squad member', local: false, speaking: p.isSpeaking
      }))]);
    } catch (err) {
      disconnect();
      setError(err.message || 'Unable to connect. Check your microphone permission and try again.');
    } finally { setBusy(false); }
  }

  function refreshParticipants() {
    const room = roomRef.current;
    if (!room) return;
    setParticipants([
      { identity: room.localParticipant.identity, name: displayName.trim(), local: true, speaking: room.localParticipant.isSpeaking },
      ...Array.from(room.remoteParticipants.values(), p => ({
        identity: p.identity, name: p.name || 'Squad member', local: false, speaking: p.isSpeaking
      }))
    ]);
  }

  async function disconnect() {
    try {
      if (localTrackRef.current) {
        localTrackRef.current.stop();
        localTrackRef.current = null;
      }
      if (roomRef.current) {
        const room = roomRef.current;
        roomRef.current = null;
        await room.disconnect();
      }
    } catch {}
    document.querySelectorAll('[data-squadcomms-audio="true"]').forEach(element => element.remove());
    joinedRef.current = false;
    setScreen('home');
    setParticipants([]);
    setRoomCode('');
    setMuted(false); setDeafened(false); setPtt(false); setPttDown(false);
  }

  async function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (localTrackRef.current) await localTrackRef.current.mute(next || deafened || (ptt && !pttDown)).catch(() => {});
  }
  async function toggleDeafen() {
    const next = !deafened;
    setDeafened(next);
    if (roomRef.current) {
      roomRef.current.remoteParticipants.forEach(p => p.audioTrackPublications.forEach(pub => {
        if (pub.track) pub.track.setVolume(next ? 0 : 1);
      }));
    }
    if (localTrackRef.current) await localTrackRef.current.mute(next || muted || (ptt && !pttDown)).catch(() => {});
  }
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`SquadComms room code: ${roomCode}`);
      setCopied(true); setTimeout(() => setCopied(false), 1600);
    } catch { setError('Clipboard access was blocked. Share the room code manually: ' + roomCode); }
  }

  const createRoom = () => {
    const code = makeCode();
    setDraftCode(code);
    joinRoom(code);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={e => { e.preventDefault(); if (!active) setScreen('home'); }}>
          <span className="brand-icon"><AudioLines size={21} strokeWidth={2.5}/></span>
          <span>Squad<span className="brand-accent">Comms</span></span>
          <span className="beta-tag">BETA</span>
        </a>
        <div className="top-status"><span className="status-dot"/>{active ? 'VOICE SESSION ACTIVE' : 'LIGHTWEIGHT VOICE'}</div>
      </header>

      {!active ? (
        <section className="landing">
          <div className="eyebrow"><span className="eyebrow-line"/> BUILT FOR THE SQUAD <span className="eyebrow-line"/></div>
          <h1>Stay in the game.<br/><span>Not in the settings.</span></h1>
          <p className="hero-copy">Crystal-clear squad comms from your browser.<br/>No download. No clutter. Just voice.</p>

          <div className="join-card">
            <div className="card-heading"><div><span className="small-label">YOUR NEXT FIRETEAM</span><h2>Jump into voice</h2></div><div className="live-mark"><Radio size={16}/> AUDIO ONLY</div></div>
            <label htmlFor="player-name">CALLSIGN</label>
            <input id="player-name" maxLength="24" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="What should your squad call you?" autoComplete="nickname"/>
            <div className="field-label-row"><label htmlFor="room-code">ROOM CODE</label><span>6–10 characters</span></div>
            <input id="room-code" maxLength="10" value={draftCode} onChange={e => setDraftCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="ENTER YOUR SQUAD CODE" className="code-input" autoCapitalize="characters"/>
            {error && <div className="error-box" role="alert"><X size={15}/>{error}</div>}
            <button className="primary-btn" disabled={busy} onClick={() => joinRoom(draftCode)}>{busy ? <span className="spinner"/> : <Radio size={18}/>} {busy ? 'CONNECTING…' : 'JOIN SQUAD'}</button>
            <div className="or-divider"><span/> OR <span/></div>
            <button className="secondary-btn" disabled={busy} onClick={createRoom}><span className="plus-icon">+</span> Create a new private room</button>
            <p className="privacy-note"><ShieldCheck size={14}/> Room codes are private invites. Share them only with your squad.</p>
          </div>

          <div className="feature-strip">
            <div><Mic size={17}/><span>Push-to-talk</span></div><i/>
            <div><Wifi size={17}/><span>Low-latency audio</span></div><i/>
            <div><Users size={17}/><span>Up to 8 players</span></div>
          </div>
          <footer>MADE FOR GAME NIGHT <span>·</span> WORKS IN FIREFOX, CHROME & EDGE</footer>
        </section>
      ) : (
        <section className="room-view">
          <div className="room-header">
            <div><div className="small-label">PRIVATE VOICE CHANNEL</div><h1>Squad room <span className="room-code">{roomCode}</span></h1></div>
            <button className="copy-btn" onClick={copyInvite}><Copy size={16}/>{copied ? 'COPIED' : 'COPY CODE'}</button>
          </div>
          <div className="connected-banner"><span className="status-dot"/><span>Connected to voice</span><span className="banner-divider">/</span><Users size={15}/><span>{participants.length}/8 players</span><span className="audio-pill">AUDIO ONLY</span></div>
          <div className="participants-card">
            <div className="participants-title"><h2>In your squad</h2><span>{participants.length} CONNECTED</span></div>
            <div className="participant-grid">
              {participants.map((p, i) => <div className={`participant ${p.speaking ? 'speaking' : ''}`} key={p.identity}>
                <div className="avatar">{(p.name || '?').slice(0, 1).toUpperCase()}<span className={`presence ${p.speaking ? 'is-speaking' : ''}`}/></div>
                <div className="participant-info"><strong>{p.name}{p.local && <span className="you-tag">YOU</span>}</strong><span>{p.speaking ? 'Speaking now' : p.local && muted ? 'Microphone muted' : 'Connected'}</span></div>
                <div className="participant-status">{p.local && muted ? <MicOff size={16}/> : p.speaking ? <AudioLines size={17}/> : <span className="quiet-dot"/>}</div>
              </div>)}
            </div>
            <div className="empty-slots">{Array.from({length: Math.max(0, 8 - participants.length)}, (_, i) => <div className="empty-slot" key={i}><span>+</span><small>OPEN SLOT</small></div>)}</div>
          </div>
          <div className="controls-card">
            <div className="control-hint"><span className="small-label">VOICE CONTROLS</span><span>{ptt ? 'HOLD SPACE TO TALK' : 'YOUR MIC IS ' + (muted || deafened ? 'MUTED' : 'LIVE')}</span></div>
            <div className="controls-row">
              <button className={`control-btn ${muted ? 'control-active' : ''}`} onClick={toggleMute} aria-pressed={muted}><span className="control-icon">{muted ? <MicOff/> : <Mic/>}</span><span>{muted ? 'Unmute' : 'Mute mic'}</span></button>
              <button className={`control-btn ${deafened ? 'control-active' : ''}`} onClick={toggleDeafen} aria-pressed={deafened}><span className="control-icon">{deafened ? <Headphones/> : <Volume2/>}</span><span>{deafened ? 'Undeafen' : 'Deafen'}</span></button>
              <button className={`control-btn ${ptt ? 'control-active' : ''}`} onClick={() => {setPtt(!ptt); setPttDown(false);}} aria-pressed={ptt}><span className="control-icon"><Radio/></span><span>{ptt ? 'PTT on' : 'Push-to-talk'}</span></button>
              {ptt && <button className={`talk-btn ${pttDown ? 'talking' : ''}`} onPointerDown={() => setPttDown(true)} onPointerUp={() => setPttDown(false)} onPointerLeave={() => setPttDown(false)} onPointerCancel={() => setPttDown(false)}>{pttDown ? 'TALKING…' : 'HOLD TO TALK'}</button>}
            </div>
            <div className="mic-state"><span className={`mic-state-dot ${!effectiveMuted ? 'mic-on' : ''}`}/>{effectiveMuted ? 'Your microphone is muted' : 'Your microphone is live'}{ptt && <span className="ptt-hint"> · Spacebar or hold button to talk</span>}</div>
          </div>
          <div className="room-bottom"><span><ShieldCheck size={15}/> Private room · Share code with trusted friends</span><button onClick={disconnect} className="leave-btn">Leave voice <X size={15}/></button></div>
        </section>
      )}
    </main>
  );
}