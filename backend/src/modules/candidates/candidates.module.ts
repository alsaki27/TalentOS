import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApplicationEntity, CandidateEntity, ProfileEntity, ResumeEntity } from "../../entities";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { CandidatesController } from "./candidates.controller";
import { CandidatesService } from "./candidates.service";

@Module({
  imports: [TypeOrmModule.forFeature([CandidateEntity, ResumeEntity, ApplicationEntity, ProfileEntity])],
  controllers: [CandidatesController],
  providers: [CandidatesService, AuthorizationService],
})
export class CandidatesModule {}
