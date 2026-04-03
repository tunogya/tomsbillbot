/**
 * Chinese localization strings.
 */
import { Locale } from "./en";

export const zh: Locale = {
  // Common
  "ok": "确定",
  "cancel": "取消",
  "error_generic": "⚠️ 出错了，请稍后再试。",
  "unauthorized": "抱歉，您没有权限执行此操作。",
  "private_only": "嘘！Tom's Bill Bot 说这个命令只能在私聊中使用。",
  "group_only": "此命令必须在群组中使用。",

  // /start
  "start_welcome": "<b>欢迎使用 Tom's Bill Bot! 💼</b>\n\n我在这里帮您记录自由职业者的工作时间，并直接在 Telegram 中管理账单。",
  "start_settings": "您当前的设置：",
  "start_help": "输入 /help 查看所有可用命令。",

  // /settings
  "settings_dashboard": "<b>⚙️ 设置面板 ({scope})</b>",
  "settings_rate": "时薪",
  "settings_granularity": "计费颗粒度",
  "settings_timezone": "时区",
  "settings_address": "付款地址",
  "settings_remark": "账单备注",
  "settings_summary": "工作总结",
  "settings_not_set": "未设置",
  "settings_edit_rate_prompt": "请回复此消息以输入新的时薪（例如：<code>50</code>）：",
  "settings_edit_granularity_prompt": "请回复此消息以输入新的计费颗粒度（分钟，例如：<code>30</code> 表示半小时）：",
  "settings_edit_timezone_prompt": "请回复此消息以输入 IANA 时区（例如：<code>Asia/Shanghai</code>, <code>UTC</code>, <code>America/New_York</code>）：",
  "settings_edit_address_prompt": "请回复此消息以输入新的 USDT 付款地址：",
  "settings_edit_remark_prompt": "请回复此消息以输入新的账单备注：",
  "settings_invalid_number": "哎呀！请输入有效的非负数字。",
  "settings_invalid_granularity": "哎呀！请输入 1 到 480 之间的整数。",
  "settings_invalid_timezone": "哎呀！这看起来不像一个有效的 IANA 时区（例如：<code>Asia/Shanghai</code>）。请再试一次。",
  "settings_updated": "✅ {field} 已更新为：<code>{value}</code>",

  // /work
  "work_invalid_hours": "Tom's Bill Bot 没听懂。请使用正数表示小时，例如 <code>/work 1.5</code>。",
  "work_logged": "<b>手工工时已记录！Tom's Bill Bot 印象深刻！</b>\n\n时长：<code>{duration} 小时</code>{tag}",
  "work_already_active": "Tom's Bill Bot 看到您已经在努力工作了！💼\n您有一个从 <code>{start_time}</code> 开始的活跃会话。\n请先使用 /done 结束会话。",
  "work_started": "<b>工作会话已开始{tag}！Tom's Bill Bot 正在计时！</b>\n\n完成后别忘了使用 /done。",
  "work_ended": "<b>工作会话已结束！Tom's Bill Bot 说干得漂亮！</b>\n\n时长：<code>{duration} 小时</code>",
  "work_no_active": "Tom's Bill Bot 找不到活跃的工作会话！请使用 /work 开始计时。",

  // /break
  "break_started": "<b>休息开始！☕</b>\n\nTom's Bill Bot 会等您的。回来后请使用 /resume。",
  "break_already": "您已经在休息了！慢慢来，Tom's Bill Bot 很有耐心。☕",
  "break_resume": "<b>欢迎回来！💼</b>\n\nTom's Bill Bot 重新开始计时。",
  "break_not_on": "您没在休息！Tom's Bill Bot 看到您正在努力工作。",

  // /history
  "history_title": "<b>您的活动记录 📜</b>",
  "history_empty": "Tom's Bill Bot 在此群组中还没发现您的任何活动。",
  "history_session": "{status}: <code>{duration}</code>",
  "history_invoice": "{emoji} 账单 #{id}: <code>${total}</code> ({status})",
  "history_payment": "💳 付款: <code>${amount}</code>",
  "history_footer": "<i>仅显示最近 10 条记录。</i>",

  // /team
  "team_title": "<b>团队面板 👥</b>",
  "team_empty": "Tom's Bill Bot 在此群组中还没发现任何团队活动。",
  "team_working": "<b>⚡ 正在工作：</b>",
  "team_member_working": "• {name}: 已工作 <code>{duration}h</code>",
  "team_summaries": "<b>📊 成员摘要：</b>",
  "team_member_summary": "• <b>{name}</b>: {unbilled}, {balance}",

  // /invoice
  "invoice_title": "<b>Tom's Bill Bot 提交的账单 #{id}{tag}</b>",
  "invoice_no_rate": "Tom's Bill Bot 注意到您在此群组的时薪尚未设置！请先使用 <code>/setrate <amount></code>。",
  "invoice_empty": "Tom's Bill Bot 在此找不到任何未开票的工时或支出{tag}。全部搞定！",
  "invoice_summary_title": "<b>摘要：</b>",
  "invoice_unpaid": "• 待付：<code>${amount}</code>",
  "invoice_pay_to": "付款至：<code>{address}</code>",
  "invoice_remark": "备注：{remark}",
  "invoices_recent_title": "<b>您最近的账单</b>",
  "invoices_empty": "Tom's Bill Bot 在此群组中还没为您开过账单。",

  // /stats
  "stats_title": "<b>您的工作统计{tag} 📊</b>",
  "stats_this_week": "<b>本周：</b>",
  "stats_this_month": "<b>本月：</b>",
  "stats_current_status": "<b>当前状态：</b>",
  "stats_hours": "• 总时长：<code>{hours} 小时</code>",
  "stats_unbilled": "• 未开票时长：<code>{hours} 小时</code>",
  "stats_estimated": "• 预估价值：<code>${amount}</code>",
  "stats_outstanding": "• 待付账单：<code>${amount}</code>",

  // /expense
  "expense_prompt": "Tom's Bill Bot 需要一些细节！用法：<code>/expense <金额> <描述></code>\n例如：<code>/expense 50 domain renewal</code>",
  "expense_no_desc": "Tom's Bill Bot 需要支出的描述！这笔钱花在哪了？",
  "expense_logged": "<b>支出已记录！💸</b>\n\n金额：<code>${amount}</code>\n描述：<code>{description}</code>",

  // /help
  "help_private_title": "<b>Tom's Bill Bot - 帮助</b>\n\n以下是我在私聊中能为您做的事：",
  "help_group_title": "<b>Tom's Bill Bot - 帮助</b>\n\n以下是我在此群组中能为您做的事：",
  "help_section_personal": "<b>个人设置与数据：</b>",
  "help_section_group": "<b>群组命令：</b>",
  "help_footer": "输入 /start 查看当前设置。",

  // /balance
  "balance_settled": "<b>当前余额：$0.00</b>\n\n您在此群组中没有待付债务或余额。",
  "balance_owe": "<b>当前余额：${amount}</b>\n\n您有未付的时薪，这意味着您需要支付之前的账单。",
  "balance_credit": "<b>当前余额：+${amount}</b>\n\n您有多付的金额。未来的账单将由此余额抵扣。",

  // /reset
  "reset_admin_only": "只有群组管理员可以重置计费数据。",
  "reset_verify_failed": "无法验证管理员状态。请确保机器人有权限查看群组成员。",
  "reset_confirm_title": "<b>⚠️ 关键操作：重置数据</b>",
  "reset_confirm_body": "这将永久删除此群组的所有工作会话、账单和付款记录。此操作<b>无法</b>撤销。\n\n您确定要这样做吗？",
  "reset_confirm_btn": "⚠️ 是的，重置所有数据",
  "reset_success": "✅ <b>呼！</b>Tom's Bill Bot 已永久重置此群组的所有历史账单、工作会话和付款记录。",
  "reset_cancelled": "呼！重置操作已取消。没有数据被删除。",

  // /export
  "export_generating": "正在生成导出文件... 请稍候。",
  "export_success": "导出完成！这是您的账单和工作记录。",
  "export_failed": "哎呀！生成导出文件时出了点问题。",

  // chatCleanup
  "cleanup_backup_title": "<b>账单备份 - {title}</b>",
  "cleanup_backup_intro": "机器人已从群组中移除。以下是您的账单摘要：",
  "cleanup_backup_open_invoices": "<b>未付账单 ({count}):</b>",
  "cleanup_backup_invoice_item": "• 账单 #{id} - 待付 <code>${amount}</code>",
  "cleanup_backup_balance_title": "<b>余额：</b>",
  "cleanup_backup_balance_invoiced": "• 总开票额：<code>${amount}</code>",
  "cleanup_backup_balance_paid": "• 总已付额：<code>${amount}</code>",
  "cleanup_backup_balance_unpaid": "• 待付余额：<code>${amount}</code>",
  "cleanup_backup_footer": "<i>这是一份备份副本。群组数据已被清除。</i>",
};
