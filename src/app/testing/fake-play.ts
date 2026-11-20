import { ActivityEntry, Command, CommandResult, PlayError, PlaySnapshot, SessionRow } from '../core/play';

/** In-memory stand-in for PlayService in component tests. */
export class FakePlayService {
  snap: PlaySnapshot = { campaign_id: 'c1', session: null, last_session_number: null, actors: [] };
  log: ActivityEntry[] = [];
  sessionList: SessionRow[] = [];
  commands: { actorId: string; cmd: Command }[] = [];
  started = 0;
  ended = 0;
  commandError: string | null = null;
  snapshots = 0;

  async snapshot(): Promise<PlaySnapshot> {
    this.snapshots++;
    return this.snap;
  }

  async start(): Promise<void> {
    this.started++;
    this.snap = { ...this.snap, session: { id: 's1', number: 1, started_at: '' } };
  }

  async end(): Promise<void> {
    this.ended++;
    this.snap = { ...this.snap, session: null, last_session_number: 1 };
  }

  async command(_c: string, _s: string, actorId: string, cmd: Command): Promise<CommandResult> {
    if (this.commandError) throw new PlayError(this.commandError);
    this.commands.push({ actorId, cmd });
    return { actor_id: actorId, current_hp: 0, effective_max_hp: 0, version: 1, effect_id: null, replayed: false };
  }

  async sessions(): Promise<SessionRow[]> {
    return this.sessionList;
  }

  async activity(): Promise<ActivityEntry[]> {
    return this.log;
  }
}
