import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from './auth.service';
import { Principal } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { Scopes } from './decorators/scopes.decorator';
import { UpdateMeDto } from './dto/auth.dto';
import { toUserResource, UserResource } from './user.mapper';

/** Current-user surface (== sdk.currentUser.show / updateProfile, doc 06). */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
@Scopes('user')
export class MeController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async show(@CurrentUser() principal: Principal): Promise<UserResource> {
    const user = await this.auth.me(principal.userId!);
    return toUserResource(user);
  }

  @Patch()
  async update(@CurrentUser() principal: Principal, @Body() dto: UpdateMeDto): Promise<UserResource> {
    const user = await this.prisma.user.update({
      where: { id: principal.userId! },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        displayName: dto.displayName,
        bio: dto.bio,
        aboutShop: dto.aboutShop,
      },
    });
    return toUserResource(user);
  }
}
