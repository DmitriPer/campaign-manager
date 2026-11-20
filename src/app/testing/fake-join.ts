import { JoinError, MyCopy, MyRequest, PendingRequest, RequestPreview, RequestStatus, RosterEntry } from '../core/join';

/** In-memory stand-in for JoinService in component tests. */
export class FakeJoinService {
  mine: MyRequest | null = null;
  pendingList: PendingRequest[] = [];
  previews = new Map<string, RequestPreview>();
  rosterList: RosterEntry[] = [];
  copy: MyCopy | null = null;
  requests: { campaignId: string; characterId: string }[] = [];
  decisions: { requestId: string; decision: string }[] = [];
  decideError: string | null = null;

  async myRequest(): Promise<MyRequest | null> {
    return this.mine;
  }

  async request(campaignId: string, characterId: string): Promise<string> {
    this.requests.push({ campaignId, characterId });
    this.mine = { id: 'req-1', status: 'pending', character_id: characterId };
    return 'req-1';
  }

  async decide(requestId: string, decision: 'approve' | 'reject' | 'cancel'): Promise<RequestStatus> {
    if (this.decideError) throw new JoinError(this.decideError);
    this.decisions.push({ requestId, decision });
    const status: RequestStatus = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'cancelled';
    this.pendingList = this.pendingList.filter((r) => r.id !== requestId);
    if (this.mine?.id === requestId) this.mine = { ...this.mine, status };
    return status;
  }

  async preview(requestId: string): Promise<RequestPreview | null> {
    return this.previews.get(requestId) ?? null;
  }

  async pending(): Promise<PendingRequest[]> {
    return this.pendingList;
  }

  async roster(): Promise<RosterEntry[]> {
    return this.rosterList;
  }

  async myCopy(): Promise<MyCopy | null> {
    return this.copy;
  }
}
