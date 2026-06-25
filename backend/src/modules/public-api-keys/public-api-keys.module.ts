import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { AuditLogEntity, ProfileEntity, PublicApiKeyEntity } from "../../entities";
import { PublicApiKeysController } from "./public-api-keys.controller";
import { PublicApiKeysService } from "./public-api-keys.service";

@Module({
  imports: [TypeOrmModule.forFeature([PublicApiKeyEntity, AuditLogEntity, ProfileEntity])],
  controllers: [PublicApiKeysController],
  providers: [PublicApiKeysService, AuthorizationService],
})
export class PublicApiKeysModule {}
