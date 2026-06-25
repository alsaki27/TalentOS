import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OrgInviteEntity, ProfileEntity } from "../../entities";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { InvitesController } from "./invites.controller";
import { InvitesService } from "./invites.service";

@Module({
  imports: [TypeOrmModule.forFeature([OrgInviteEntity, ProfileEntity])],
  controllers: [InvitesController],
  providers: [InvitesService, AuthorizationService],
  exports: [InvitesService],
})
export class InvitesModule {}
