/**
 * English localization strings.
 */

export const en = {
  // Common
  "ok": "OK",
  "cancel": "Cancel",
  "error_generic": "⚠️ Something went wrong. Please try again later.",
  "unauthorized": "Oops! You're not authorized to do that.",
  "private_only": "Psst! Tom's Bill Bot says this command can only be used in our secret DMs.",
  "group_only": "This command must be used in a group chat.",

  // /start
  "start_welcome": "<b>Welcome to Tom's Bill Bot! 💼</b>\n\nI'm here to help you track your freelancer work hours and manage invoices directly in Telegram.",
  "start_settings": "Your current settings:",
  "start_help": "Type /help to see all available commands.",

  // /settings
  "settings_dashboard": "<b>⚙️ Settings Dashboard ({scope})</b>",
  "settings_rate": "Hourly Rate",
  "settings_granularity": "Billing Granularity",
  "settings_timezone": "Timezone",
  "settings_address": "Payment Address",
  "settings_remark": "Invoice Remark",
  "settings_summary": "Work Summary",
  "settings_not_set": "Not set",
  "settings_edit_rate_prompt": "Please reply to this message with your new hourly rate (e.g., <code>50</code>):",
  "settings_edit_granularity_prompt": "Please reply to this message with your new billing granularity in minutes (e.g., <code>30</code> for half-hour):",
  "settings_edit_timezone_prompt": "Please reply to this message with your IANA timezone (e.g., <code>Asia/Shanghai</code>, <code>UTC</code>, <code>America/New_York</code>):",
  "settings_edit_address_prompt": "Please reply to this message with your new USDT payment address:",
  "settings_edit_remark_prompt": "Please reply to this message with your new invoice remark:",
  "settings_invalid_number": "Oops! Please provide a valid non-negative number.",
  "settings_invalid_granularity": "Oops! Please provide a whole number between 1 and 480.",
  "settings_invalid_timezone": "Oops! That doesn't look like a valid IANA timezone (e.g., <code>Asia/Shanghai</code>). Please try again.",
  "settings_updated": "✅ {field} updated to: <code>{value}</code>",

  // /work
  "work_invalid_hours": "Tom's Bill Bot didn't catch that. Please use a positive number for the hours, like <code>/work 1.5</code>.",
  "work_logged": "<b>Manual work logged! Tom's Bill Bot is impressed!</b>\n\nDuration: <code>{duration} hours</code>{tag}",
  "work_already_active": "Tom's Bill Bot sees you're already grinding! 💼\nYou have an active session from <code>{start_time}</code>.\nUse /done to clock out first.",
  "work_started": "<b>Work session started{tag}! Tom's Bill Bot is on the clock!</b>\n\nDon't forget to use /done when you're finished.",
  "work_ended": "<b>Work session ended! Tom's Bill Bot says great job!</b>\n\nDuration: <code>{duration} hours</code>",
  "work_no_active": "Tom's Bill Bot couldn't find an active work session! Use /work to clock in.",

  // /break
  "break_started": "<b>Break started! ☕</b>\n\nTom's Bill Bot is waiting for you. Use /resume when you're back.",
  "break_already": "You're already on a break! Take your time, Tom's Bill Bot is patient. ☕",
  "break_resume": "<b>Welcome back! 💼</b>\n\nTom's Bill Bot is back on the clock.",
  "break_not_on": "You're not on a break! Tom's Bill Bot sees you're already hard at work.",

  // /history
  "history_title": "<b>Your Activity History 📜</b>",
  "history_empty": "Tom's Bill Bot couldn't find any activity for you in this chat yet.",
  "history_session": "{status}: <code>{duration}</code>",
  "history_invoice": "{emoji} Invoice #{id}: <code>${total}</code> ({status})",
  "history_payment": "💳 Payment: <code>${amount}</code>",
  "history_footer": "<i>Showing up to 10 most recent events.</i>",

  // /team
  "team_title": "<b>Team Dashboard 👥</b>",
  "team_empty": "Tom's Bill Bot doesn't see any team activity in this group yet.",
  "team_working": "<b>⚡ Currently Working:</b>",
  "team_member_working": "• {name}: <code>{duration}h</code> so far",
  "team_summaries": "<b>📊 Member Summaries:</b>",
  "team_member_summary": "• <b>{name}</b>: {unbilled}, {balance}",

  // /invoice
  "invoice_title": "<b>Tom's Bill Bot presents Invoice #{id}{tag}</b>",
  "invoice_no_rate": "Tom's Bill Bot noticed your hourly rate for this chat is missing! Use <code>/setrate <amount></code> first.",
  "invoice_empty": "Tom's Bill Bot couldn't find any uninvoiced work sessions or expenses here{tag}. All caught up!",
  "invoice_summary_title": "Summary:",
  "invoice_unpaid": "• Unpaid: <code>${amount}</code>",
  "invoice_pay_to": "Pay to: <code>{address}</code>",
  "invoice_remark": "Remark: {remark}",
  "invoices_recent_title": "<b>Your Recent Invoices</b>",
  "invoices_empty": "Tom's Bill Bot couldn't find any invoices for you in this chat yet.",

  // /stats
  "stats_title": "<b>Your Work Stats{tag} 📊</b>",
  "stats_this_week": "<b>This Week:</b>",
  "stats_this_month": "<b>This Month:</b>",
  "stats_current_status": "<b>Current Status:</b>",
  "stats_hours": "• Total Hours: <code>{hours} hrs</code>",
  "stats_unbilled": "• Unbilled Hours: <code>{hours} hrs</code>",
  "stats_estimated": "• Estimated Value: <code>${amount}</code>",
  "stats_outstanding": "• Outstanding Invoices: <code>${amount}</code>",

  // /expense
  "expense_prompt": "Tom's Bill Bot needs some details! Usage: <code>/expense <amount> <description></code>\nExample: <code>/expense 50 domain renewal</code>",
  "expense_no_desc": "Tom's Bill Bot needs a description for the expense! What was it for?",
  "expense_logged": "<b>Expense logged! 💸</b>\n\nAmount: <code>${amount}</code>\nDescription: <code>{description}</code>",

  // /help
  "help_private_title": "<b>Tom's Bill Bot - Help</b>\n\nHere's what I can do for you in our DMs:",
  "help_group_title": "<b>Tom's Bill Bot - Help</b>\n\nHere's what I can do in this group:",
  "help_section_personal": "<b>Personal Settings & Data:</b>",
  "help_section_group": "<b>Group Commands:</b>",
  "help_footer": "Type /start to see your current settings.",

  // /balance
  "balance_settled": "<b>Balance: $0.00</b>\n\nYou have no pending debts or credits in this group.",
  "balance_owe": "<b>Balance: ${amount}</b>\n\nYou have an unpaid debit balance. This means you owe money for past invoices that haven't been fully paid yet.",
  "balance_credit": "<b>Balance: +${amount}</b>\n\nYou have a credit balance. This means you have overpaid. Future invoices will be offset by this credit.",

  // /reset
  "reset_admin_only": "Only group admins can reset billing data.",
  "reset_verify_failed": "Unable to verify admin status. Please make sure the bot has permission to see group members.",
  "reset_confirm_title": "<b>⚠️ CRITICAL ACTION: RESET DATA</b>",
  "reset_confirm_body": "This will permanently delete all work sessions, invoices, and payment history for this group. This action <b>CANNOT</b> be undone.\n\nAre you absolutely sure?",
  "reset_confirm_btn": "⚠️ Yes, Reset Everything",
  "reset_success": "✅ <b>Poof!</b> Tom's Bill Bot has permanently reset all historical bills, work sessions, and payments for this group.",
  "reset_cancelled": "Whew! Reset operation cancelled. No data was deleted.",

  // /export
  "export_generating": "Generating your export files... Please wait a moment.",
  "export_success": "Export complete! Here are your invoices and work sessions records.",
  "export_failed": "Oops! Something went wrong while generating your export.",

  // chatCleanup
  "cleanup_backup_title": "<b>Bill Backup - {title}</b>",
  "cleanup_backup_intro": "The bot was removed from the group. Here is your billing summary:",
  "cleanup_backup_open_invoices": "<b>Open Invoices ({count}):</b>",
  "cleanup_backup_invoice_item": "• Invoice #{id} - <code>${amount}</code> due",
  "cleanup_backup_balance_title": "<b>Balance:</b>",
  "cleanup_backup_balance_invoiced": "• Total Invoiced: <code>${amount}</code>",
  "cleanup_backup_balance_paid": "• Total Paid: <code>${amount}</code>",
  "cleanup_backup_balance_unpaid": "• Unpaid: <code>${amount}</code>",
  "cleanup_backup_footer": "<i>This is a backup copy. The group data has been cleared.</i>",
};

export type Locale = typeof en;
export type LocaleKey = keyof Locale;
