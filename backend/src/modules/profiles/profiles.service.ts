import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ProfileEntity } from "../../entities";
import { CreateProfileDto, UpdateProfileDto } from "./dtos";

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(ProfileEntity)
    private readonly profiles: Repository<ProfileEntity>,
  ) {}

  list() {
    return this.profiles.find({ order: { createdAt: "DESC" } });
  }

  create(dto: CreateProfileDto) {
    return this.profiles.save(this.profiles.create(dto));
  }

  async update(id: string, dto: UpdateProfileDto) {
    const profile = await this.profiles.findOne({ where: { id } });
    if (!profile) throw new NotFoundException("Profile not found.");
    Object.assign(profile, dto);
    return this.profiles.save(profile);
  }
}
