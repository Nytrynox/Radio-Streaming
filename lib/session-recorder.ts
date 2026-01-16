// ============================================================================
// SESSION RECORDER
// Records and plays back sensor sessions
// ============================================================================

import type { RecordedSession, SessionEvent, SensorFusion } from './types';
import { 
  createSession, 
  endSession, 
  addEvent, 
  getSession, 
  getEventsBySession,
  getAllSessions,
  deleteSession 
} from './db';

export class SessionRecorder {
  private currentSessionId: string | null = null;
  private isRecording = false;
  private eventCount = 0;
  private startTime = 0;

  public async startRecording(name?: string): Promise<string> {
    if (this.isRecording) {
      await this.stopRecording();
    }

    const sessionName = name || `Session ${new Date().toLocaleString()}`;
    const session = await createSession(sessionName);
    this.currentSessionId = session.id;
    this.isRecording = true;
    this.eventCount = 0;
    this.startTime = Date.now();

    console.log('Recording started:', session.id);
    return session.id;
  }

  public async stopRecording(): Promise<RecordedSession | null> {
    if (!this.isRecording || !this.currentSessionId) return null;

    await endSession(this.currentSessionId);
    const session = await getSession(this.currentSessionId);
    
    this.isRecording = false;
    this.currentSessionId = null;
    
    console.log('Recording stopped:', session?.id);
    return session || null;
  }

  public async recordEvent(type: SessionEvent['type'], data: any) {
    if (!this.isRecording || !this.currentSessionId) return;

    const event: SessionEvent = {
      timestamp: Date.now(),
      type,
      data,
    };

    await addEvent(this.currentSessionId, event);
    this.eventCount++;
  }

  public isActive(): boolean {
    return this.isRecording;
  }

  public getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  public getStats(): { eventCount: number; duration: number } {
    return {
      eventCount: this.eventCount,
      duration: this.isRecording ? Date.now() - this.startTime : 0,
    };
  }
}

// ============================================================================
// SESSION PLAYER
// Plays back recorded sessions
// ============================================================================

export class SessionPlayer {
  private session: RecordedSession | null = null;
  private events: SessionEvent[] = [];
  private currentIndex = 0;
  private isPlaying = false;
  private isPaused = false;
  private playbackSpeed = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onEvent: ((event: SessionEvent) => void) | null = null;
  private onEnd: (() => void) | null = null;

  public async loadSession(sessionId: string): Promise<boolean> {
    const session = await getSession(sessionId);
    if (!session) return false;

    this.session = session;
    this.events = await getEventsBySession(sessionId);
    this.events.sort((a, b) => a.timestamp - b.timestamp);
    this.currentIndex = 0;
    this.isPlaying = false;
    this.isPaused = false;

    console.log('Session loaded:', sessionId, 'Events:', this.events.length);
    return true;
  }

  public play(options: {
    speed?: number;
    onEvent: (event: SessionEvent) => void;
    onEnd?: () => void;
  }) {
    if (!this.session || this.events.length === 0) return;

    this.playbackSpeed = options.speed || 1;
    this.onEvent = options.onEvent;
    this.onEnd = options.onEnd || null;
    this.isPlaying = true;
    this.isPaused = false;

    this.scheduleNextEvent();
  }

  private scheduleNextEvent() {
    if (!this.isPlaying || this.isPaused) return;
    if (this.currentIndex >= this.events.length) {
      this.stop();
      this.onEnd?.();
      return;
    }

    const currentEvent = this.events[this.currentIndex];
    const nextEvent = this.events[this.currentIndex + 1];

    // Emit current event
    this.onEvent?.(currentEvent);
    this.currentIndex++;

    if (nextEvent) {
      // Schedule next event
      const delay = (nextEvent.timestamp - currentEvent.timestamp) / this.playbackSpeed;
      this.timer = setTimeout(() => this.scheduleNextEvent(), Math.max(10, delay));
    } else {
      this.stop();
      this.onEnd?.();
    }
  }

  public pause() {
    this.isPaused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public resume() {
    if (!this.isPlaying) return;
    this.isPaused = false;
    this.scheduleNextEvent();
  }

  public stop() {
    this.isPlaying = false;
    this.isPaused = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public seek(percentage: number) {
    const targetIndex = Math.floor(this.events.length * Math.max(0, Math.min(1, percentage)));
    this.currentIndex = targetIndex;
    
    if (this.isPlaying && !this.isPaused) {
      if (this.timer) clearTimeout(this.timer);
      this.scheduleNextEvent();
    }
  }

  public setSpeed(speed: number) {
    this.playbackSpeed = Math.max(0.1, Math.min(10, speed));
  }

  public getProgress(): number {
    if (this.events.length === 0) return 0;
    return this.currentIndex / this.events.length;
  }

  public getCurrentTime(): number {
    if (this.currentIndex === 0 || this.events.length === 0) return 0;
    return this.events[this.currentIndex - 1]?.timestamp - this.events[0].timestamp;
  }

  public getTotalDuration(): number {
    if (this.events.length < 2) return 0;
    return this.events[this.events.length - 1].timestamp - this.events[0].timestamp;
  }

  public isActivelyPlaying(): boolean {
    return this.isPlaying && !this.isPaused;
  }

  public getStatus(): 'stopped' | 'playing' | 'paused' {
    if (!this.isPlaying) return 'stopped';
    if (this.isPaused) return 'paused';
    return 'playing';
  }
}

// ============================================================================
// SESSION MANAGER
// High-level session management
// ============================================================================

export class SessionManager {
  private recorder = new SessionRecorder();
  private player = new SessionPlayer();

  public getRecorder(): SessionRecorder {
    return this.recorder;
  }

  public getPlayer(): SessionPlayer {
    return this.player;
  }

  public async listSessions(): Promise<RecordedSession[]> {
    return getAllSessions();
  }

  public async deleteSession(sessionId: string): Promise<void> {
    if (this.player.getStatus() !== 'stopped') {
      this.player.stop();
    }
    await deleteSession(sessionId);
  }

  public async getSessionSummary(sessionId: string): Promise<{
    name: string;
    duration: number;
    eventCount: number;
    startTime: number;
    endTime: number | null;
  } | null> {
    const session = await getSession(sessionId);
    if (!session) return null;

    const events = await getEventsBySession(sessionId);

    return {
      name: session.name,
      duration: session.endTime ? session.endTime - session.startTime : 0,
      eventCount: events.length,
      startTime: session.startTime,
      endTime: session.endTime,
    };
  }
}
