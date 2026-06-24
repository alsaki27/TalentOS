import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApplicationEntity, CandidateEntity, ProfileEntity, ResumeEntity } from "../../entities";
import { CandidatesController } from "./candidates.controller";
import { CandidatesService } from "./candidates.service";

@Module({
  imports: [TypeOrmModule.forFeature([CandidateEntity, ResumeEntity, ApplicationEntity, ProfileEntity])],
  controllers: [CandidatesController],
  providers: [CandidatesService],
})
export class CandidatesModule {}
