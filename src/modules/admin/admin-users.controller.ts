import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/pagination/cursor.util';
import { Principal } from '../identity/auth.types';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { Scopes } from '../identity/decorators/scopes.decorator';
import { AdminUserDetail, AdminUsersService } from './admin-users.service';
import { AdminUserResource } from './admin-user.mapper';
import { BanUserDto, ListUsersQueryDto, RestrictUserDto, UnrestrictUserDto } from './dto/admin-users.dto';
import { OperatorGuard } from './guards/operator.guard';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(OperatorGuard)
@Scopes('user')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  async list(@Query() q: ListUsersQueryDto): Promise<Page<AdminUserResource>> {
    return this.users.list(q.perPage, q.cursor, q.status);
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDetail> {
    return this.users.detail(id);
  }

  @Post(':id/restrict')
  async restrict(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestrictUserDto,
  ): Promise<AdminUserResource> {
    return this.users.restrict(me.userId!, id, dto.reason);
  }

  @Post(':id/unrestrict')
  async unrestrict(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UnrestrictUserDto,
  ): Promise<AdminUserResource> {
    return this.users.unrestrict(me.userId!, id, dto.reason);
  }

  @Post(':id/ban')
  async ban(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BanUserDto,
  ): Promise<AdminUserResource> {
    return this.users.ban(me.userId!, id, dto.reason);
  }
}
