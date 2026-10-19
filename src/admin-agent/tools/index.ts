import { AuditLogService } from '../../audit-log/audit-log.service'
import { AdminMonitoringService } from '../../monitoring/admin-monitoring.service'
import { AdminDashboardService } from '../../admin-dashboard/admin-dashboard.service'
import { usersTools } from './users.tools'
import { paymentsTools } from './payments.tools'
import { publishingTools } from './publishing.tools'
import { systemTools } from './system.tools'
import { inboxTools } from './inbox.tools'
import { contentTools } from './content.tools'

export interface ToolDeps {
  auditLog: AuditLogService
  adminMonitoring: AdminMonitoringService
  adminDashboard: AdminDashboardService
}

// All tools are read-only. Each area lives in its own file so it can later
// become its own specialist agent, or be given only to the matching admin role.
export function buildAdminAgentTools(deps: ToolDeps) {
  return [
    ...systemTools(deps),
    ...usersTools(deps),
    ...paymentsTools(deps),
    ...publishingTools(deps),
    ...inboxTools(deps),
    ...contentTools(deps),
  ]
}
