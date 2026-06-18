import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClerkAuthGuard } from "../../common/auth/clerk-auth.guard";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../../common/auth/current-user.decorator";
import { CreatePublicApiKeyDto } from "./dtos";
import { PublicApiKeysService } from "./public-api-keys.service";

@ApiTags("public-api-keys")
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller("api-keys")
export class PublicApiKeysController {
  constructor(private readonly apiKeys: PublicApiKeysService) {}

  @Get()
  @ApiOperation({ summary: "List active public API keys. Admin only." })
  list(@CurrentUser() user: CurrentUserType) {
    return this.apiKeys.list(user);
  }

  @Post()
  @ApiOperation({ summary: "Create a scoped public API key. Admin only." })
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreatePublicApiKeyDto) {
    return this.apiKeys.create(user, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Revoke public API key. Admin only." })
  revoke(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    return this.apiKeys.revoke(user, id);
  }
}
