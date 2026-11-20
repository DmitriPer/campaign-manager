import { CampaignError, CampaignSummary, PublicProfile, Visibility } from '../core/campaigns';

/** In-memory stand-in for CampaignsService in component tests. */
export class FakeCampaignsService {
  mine: CampaignSummary[] = [];
  publicProfiles = new Map<string, PublicProfile>();
  created: { name: string; description: string }[] = [];
  visibilityCalls: { id: string; visibility: Visibility }[] = [];
  createError: string | null = null;

  async listMine(): Promise<CampaignSummary[]> {
    return this.mine;
  }

  async getAsMember(id: string): Promise<CampaignSummary | null> {
    return this.mine.find((c) => c.id === id) ?? null;
  }

  async getPublicProfile(id: string): Promise<PublicProfile | null> {
    return this.publicProfiles.get(id) ?? null;
  }

  async create(name: string, description: string): Promise<string> {
    if (this.createError) throw new CampaignError(this.createError);
    this.created.push({ name, description });
    return 'new-campaign-id';
  }

  async setVisibility(id: string, visibility: Visibility): Promise<Visibility> {
    this.visibilityCalls.push({ id, visibility });
    return visibility;
  }
}
