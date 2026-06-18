import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ProfileEntity, UserRole } from "../../entities";
import { CurrentUser } from "./current-user.decorator";

export const MASTER_DATA_ROLES: UserRole[] = ["admin", "manager", "recruiter"];
export const ASSIGNMENT_MANAGER_ROLES: UserRole[] = ["admin", "manager", "recruiter"];
export const DESTRUCTIVE_ROLES: UserRole[] = ["admin", "manager"];

@Injectable()
export class AuthorizationService {
  constructor(
    @InjectRepository(ProfileEntity)
    private readonly profiles: Repository<ProfileEntity>,
  ) {}

  async profileFor(user: CurrentUser): Promise<ProfileEntity> {
    const profile = await this.profiles.findOne({ where: { clerkUserId: user.clerkUserId, isActive: true } });
    if (!profile) throw new NotFoundException("Active profile not found for Clerk user.");
    user.profileId = profile.id;
    user.email = profile.email;
    user.role = profile.role;
    return profile;
  }

  async requireRole(user: CurrentUser, roles: UserRole[]): Promise<ProfileEntity> {
    const profile = await this.profileFor(user);
    if (!roles.includes(profile.role)) {
      throw new ForbiddenException(`Requires one of: ${roles.join(", ")}`);
    }
    return profile;
  }

  assertApplicationVisibility(profile: ProfileEntity, application: { assignedToUserId?: string | null; assignedTo?: string | null }) {
    if (profile.role !== "application_engineer") return;
    const ownsTicket = application.assignedToUserId === profile.id
      || application.assignedTo === profile.email
      || application.assignedTo === profile.displayName;
    if (!ownsTicket) throw new ForbiddenException("Application engineers can only access assigned tickets.");
  }
}
