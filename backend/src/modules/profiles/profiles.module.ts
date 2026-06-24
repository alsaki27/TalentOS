import { Module, Global } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProfileEntity } from "../../entities";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { ProfilesController } from "./profiles.controller";
import { ProfilesService } from "./profiles.service";

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ProfileEntity])],
  controllers: [ProfilesController],
  providers: [ProfilesService, AuthorizationService],
  exports: [ProfilesService, AuthorizationService, TypeOrmModule],
})
export class ProfilesModule {}
