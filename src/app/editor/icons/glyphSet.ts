/**
 * Inline glyphs — the "Glyphs" tab of /icon: a curated set of lucide icons with English and German
 * search words. This module is loaded on demand (icons/glyphs.ts imports it lazily, see there for
 * the bundle note) and holds the raw icon nodes, not React components: the editor, exports and
 * share links all draw the same SVG from them. Names are lucide's own canonical (kebab-case) names —
 * aliases such as "trash-2" re-export another file without the data, so they can't be used here.
 */
import type { LucideIconData, LucideIconNode } from 'lucide-react'
import { __iconData as iCheck } from 'lucide-react/dist/esm/icons/check.mjs'
import { __iconData as iCheckCheck } from 'lucide-react/dist/esm/icons/check-check.mjs'
import { __iconData as iCircleCheck } from 'lucide-react/dist/esm/icons/circle-check.mjs'
import { __iconData as iCircleX } from 'lucide-react/dist/esm/icons/circle-x.mjs'
import { __iconData as iX } from 'lucide-react/dist/esm/icons/x.mjs'
import { __iconData as iCircleAlert } from 'lucide-react/dist/esm/icons/circle-alert.mjs'
import { __iconData as iTriangleAlert } from 'lucide-react/dist/esm/icons/triangle-alert.mjs'
import { __iconData as iOctagonAlert } from 'lucide-react/dist/esm/icons/octagon-alert.mjs'
import { __iconData as iInfo } from 'lucide-react/dist/esm/icons/info.mjs'
import { __iconData as iCircleQuestionMark } from 'lucide-react/dist/esm/icons/circle-question-mark.mjs'
import { __iconData as iBan } from 'lucide-react/dist/esm/icons/ban.mjs'
import { __iconData as iCircleDot } from 'lucide-react/dist/esm/icons/circle-dot.mjs'
import { __iconData as iCircle } from 'lucide-react/dist/esm/icons/circle.mjs'
import { __iconData as iSquare } from 'lucide-react/dist/esm/icons/square.mjs'
import { __iconData as iSquareCheck } from 'lucide-react/dist/esm/icons/square-check.mjs'
import { __iconData as iCirclePlus } from 'lucide-react/dist/esm/icons/circle-plus.mjs'
import { __iconData as iCircleMinus } from 'lucide-react/dist/esm/icons/circle-minus.mjs'
import { __iconData as iPlus } from 'lucide-react/dist/esm/icons/plus.mjs'
import { __iconData as iMinus } from 'lucide-react/dist/esm/icons/minus.mjs'
import { __iconData as iShieldCheck } from 'lucide-react/dist/esm/icons/shield-check.mjs'
import { __iconData as iBadgeCheck } from 'lucide-react/dist/esm/icons/badge-check.mjs'
import { __iconData as iThumbsUp } from 'lucide-react/dist/esm/icons/thumbs-up.mjs'
import { __iconData as iThumbsDown } from 'lucide-react/dist/esm/icons/thumbs-down.mjs'
import { __iconData as iFlag } from 'lucide-react/dist/esm/icons/flag.mjs'
import { __iconData as iBookmark } from 'lucide-react/dist/esm/icons/bookmark.mjs'
import { __iconData as iPin } from 'lucide-react/dist/esm/icons/pin.mjs'
import { __iconData as iStar } from 'lucide-react/dist/esm/icons/star.mjs'
import { __iconData as iHeart } from 'lucide-react/dist/esm/icons/heart.mjs'
import { __iconData as iSparkle } from 'lucide-react/dist/esm/icons/sparkle.mjs'
import { __iconData as iArrowRight } from 'lucide-react/dist/esm/icons/arrow-right.mjs'
import { __iconData as iArrowLeft } from 'lucide-react/dist/esm/icons/arrow-left.mjs'
import { __iconData as iArrowUp } from 'lucide-react/dist/esm/icons/arrow-up.mjs'
import { __iconData as iArrowDown } from 'lucide-react/dist/esm/icons/arrow-down.mjs'
import { __iconData as iArrowUpRight } from 'lucide-react/dist/esm/icons/arrow-up-right.mjs'
import { __iconData as iArrowDownRight } from 'lucide-react/dist/esm/icons/arrow-down-right.mjs'
import { __iconData as iArrowRightLeft } from 'lucide-react/dist/esm/icons/arrow-right-left.mjs'
import { __iconData as iMoveRight } from 'lucide-react/dist/esm/icons/move-right.mjs'
import { __iconData as iChevronRight } from 'lucide-react/dist/esm/icons/chevron-right.mjs'
import { __iconData as iChevronLeft } from 'lucide-react/dist/esm/icons/chevron-left.mjs'
import { __iconData as iChevronUp } from 'lucide-react/dist/esm/icons/chevron-up.mjs'
import { __iconData as iChevronDown } from 'lucide-react/dist/esm/icons/chevron-down.mjs'
import { __iconData as iChevronsRight } from 'lucide-react/dist/esm/icons/chevrons-right.mjs'
import { __iconData as iCornerDownRight } from 'lucide-react/dist/esm/icons/corner-down-right.mjs'
import { __iconData as iRedo2 } from 'lucide-react/dist/esm/icons/redo-2.mjs'
import { __iconData as iUndo2 } from 'lucide-react/dist/esm/icons/undo-2.mjs'
import { __iconData as iRefreshCw } from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
import { __iconData as iRotateCw } from 'lucide-react/dist/esm/icons/rotate-cw.mjs'
import { __iconData as iRepeat } from 'lucide-react/dist/esm/icons/repeat.mjs'
import { __iconData as iShuffle } from 'lucide-react/dist/esm/icons/shuffle.mjs'
import { __iconData as iTrendingUp } from 'lucide-react/dist/esm/icons/trending-up.mjs'
import { __iconData as iTrendingDown } from 'lucide-react/dist/esm/icons/trending-down.mjs'
import { __iconData as iExternalLink } from 'lucide-react/dist/esm/icons/external-link.mjs'
import { __iconData as iLogIn } from 'lucide-react/dist/esm/icons/log-in.mjs'
import { __iconData as iLogOut } from 'lucide-react/dist/esm/icons/log-out.mjs'
import { __iconData as iDownload } from 'lucide-react/dist/esm/icons/download.mjs'
import { __iconData as iUpload } from 'lucide-react/dist/esm/icons/upload.mjs'
import { __iconData as iShare2 } from 'lucide-react/dist/esm/icons/share-2.mjs'
import { __iconData as iForward } from 'lucide-react/dist/esm/icons/forward.mjs'
import { __iconData as iReply } from 'lucide-react/dist/esm/icons/reply.mjs'
import { __iconData as iClock } from 'lucide-react/dist/esm/icons/clock.mjs'
import { __iconData as iAlarmClock } from 'lucide-react/dist/esm/icons/alarm-clock.mjs'
import { __iconData as iTimer } from 'lucide-react/dist/esm/icons/timer.mjs'
import { __iconData as iHourglass } from 'lucide-react/dist/esm/icons/hourglass.mjs'
import { __iconData as iCalendar } from 'lucide-react/dist/esm/icons/calendar.mjs'
import { __iconData as iCalendarDays } from 'lucide-react/dist/esm/icons/calendar-days.mjs'
import { __iconData as iCalendarCheck } from 'lucide-react/dist/esm/icons/calendar-check.mjs'
import { __iconData as iCalendarClock } from 'lucide-react/dist/esm/icons/calendar-clock.mjs'
import { __iconData as iRotateCcwClock } from 'lucide-react/dist/esm/icons/rotate-ccw-clock.mjs'
import { __iconData as iWatch } from 'lucide-react/dist/esm/icons/watch.mjs'
import { __iconData as iSunrise } from 'lucide-react/dist/esm/icons/sunrise.mjs'
import { __iconData as iSunset } from 'lucide-react/dist/esm/icons/sunset.mjs'
import { __iconData as iUser } from 'lucide-react/dist/esm/icons/user.mjs'
import { __iconData as iUsers } from 'lucide-react/dist/esm/icons/users.mjs'
import { __iconData as iUserPlus } from 'lucide-react/dist/esm/icons/user-plus.mjs'
import { __iconData as iUserCheck } from 'lucide-react/dist/esm/icons/user-check.mjs'
import { __iconData as iContact } from 'lucide-react/dist/esm/icons/contact.mjs'
import { __iconData as iFaceSlightlySmiling } from 'lucide-react/dist/esm/icons/face-slightly-smiling.mjs'
import { __iconData as iFaceSlightlyFrowning } from 'lucide-react/dist/esm/icons/face-slightly-frowning.mjs'
import { __iconData as iFaceNeutral } from 'lucide-react/dist/esm/icons/face-neutral.mjs'
import { __iconData as iFaceGrinning } from 'lucide-react/dist/esm/icons/face-grinning.mjs'
import { __iconData as iMessageSquare } from 'lucide-react/dist/esm/icons/message-square.mjs'
import { __iconData as iMessageCircle } from 'lucide-react/dist/esm/icons/message-circle.mjs'
import { __iconData as iMessagesSquare } from 'lucide-react/dist/esm/icons/messages-square.mjs'
import { __iconData as iMail } from 'lucide-react/dist/esm/icons/mail.mjs'
import { __iconData as iSend } from 'lucide-react/dist/esm/icons/send.mjs'
import { __iconData as iPhone } from 'lucide-react/dist/esm/icons/phone.mjs'
import { __iconData as iVideo } from 'lucide-react/dist/esm/icons/video.mjs'
import { __iconData as iMic } from 'lucide-react/dist/esm/icons/mic.mjs'
import { __iconData as iMegaphone } from 'lucide-react/dist/esm/icons/megaphone.mjs'
import { __iconData as iBell } from 'lucide-react/dist/esm/icons/bell.mjs'
import { __iconData as iBellRing } from 'lucide-react/dist/esm/icons/bell-ring.mjs'
import { __iconData as iAtSign } from 'lucide-react/dist/esm/icons/at-sign.mjs'
import { __iconData as iHash } from 'lucide-react/dist/esm/icons/hash.mjs'
import { __iconData as iQuote } from 'lucide-react/dist/esm/icons/quote.mjs'
import { __iconData as iHandshake } from 'lucide-react/dist/esm/icons/handshake.mjs'
import { __iconData as iHand } from 'lucide-react/dist/esm/icons/hand.mjs'
import { __iconData as iPartyPopper } from 'lucide-react/dist/esm/icons/party-popper.mjs'
import { __iconData as iBaby } from 'lucide-react/dist/esm/icons/baby.mjs'
import { __iconData as iPersonStanding } from 'lucide-react/dist/esm/icons/person-standing.mjs'
import { __iconData as iBriefcase } from 'lucide-react/dist/esm/icons/briefcase.mjs'
import { __iconData as iBuildingComplex } from 'lucide-react/dist/esm/icons/building-complex.mjs'
import { __iconData as iLandmark } from 'lucide-react/dist/esm/icons/landmark.mjs'
import { __iconData as iStore } from 'lucide-react/dist/esm/icons/store.mjs'
import { __iconData as iShoppingCart } from 'lucide-react/dist/esm/icons/shopping-cart.mjs'
import { __iconData as iShoppingBag } from 'lucide-react/dist/esm/icons/shopping-bag.mjs'
import { __iconData as iPackage } from 'lucide-react/dist/esm/icons/package.mjs'
import { __iconData as iTruck } from 'lucide-react/dist/esm/icons/truck.mjs'
import { __iconData as iWallet } from 'lucide-react/dist/esm/icons/wallet.mjs'
import { __iconData as iCreditCard } from 'lucide-react/dist/esm/icons/credit-card.mjs'
import { __iconData as iBanknote } from 'lucide-react/dist/esm/icons/banknote.mjs'
import { __iconData as iCoins } from 'lucide-react/dist/esm/icons/coins.mjs'
import { __iconData as iReceipt } from 'lucide-react/dist/esm/icons/receipt.mjs'
import { __iconData as iPiggyBank } from 'lucide-react/dist/esm/icons/piggy-bank.mjs'
import { __iconData as iCircleDollarSign } from 'lucide-react/dist/esm/icons/circle-dollar-sign.mjs'
import { __iconData as iEuro } from 'lucide-react/dist/esm/icons/euro.mjs'
import { __iconData as iChartLine } from 'lucide-react/dist/esm/icons/chart-line.mjs'
import { __iconData as iChartColumn } from 'lucide-react/dist/esm/icons/chart-column.mjs'
import { __iconData as iChartPie } from 'lucide-react/dist/esm/icons/chart-pie.mjs'
import { __iconData as iChartBar } from 'lucide-react/dist/esm/icons/chart-bar.mjs'
import { __iconData as iGauge } from 'lucide-react/dist/esm/icons/gauge.mjs'
import { __iconData as iTarget } from 'lucide-react/dist/esm/icons/target.mjs'
import { __iconData as iTrophy } from 'lucide-react/dist/esm/icons/trophy.mjs'
import { __iconData as iAward } from 'lucide-react/dist/esm/icons/award.mjs'
import { __iconData as iMedal } from 'lucide-react/dist/esm/icons/medal.mjs'
import { __iconData as iCrown } from 'lucide-react/dist/esm/icons/crown.mjs'
import { __iconData as iRocket } from 'lucide-react/dist/esm/icons/rocket.mjs'
import { __iconData as iPresentation } from 'lucide-react/dist/esm/icons/presentation.mjs'
import { __iconData as iScale } from 'lucide-react/dist/esm/icons/scale.mjs'
import { __iconData as iCalculator } from 'lucide-react/dist/esm/icons/calculator.mjs'
import { __iconData as iPercent } from 'lucide-react/dist/esm/icons/percent.mjs'
import { __iconData as iTag } from 'lucide-react/dist/esm/icons/tag.mjs'
import { __iconData as iTags } from 'lucide-react/dist/esm/icons/tags.mjs'
import { __iconData as iTicket } from 'lucide-react/dist/esm/icons/ticket.mjs'
import { __iconData as iGift } from 'lucide-react/dist/esm/icons/gift.mjs'
import { __iconData as iFile } from 'lucide-react/dist/esm/icons/file.mjs'
import { __iconData as iFileText } from 'lucide-react/dist/esm/icons/file-text.mjs'
import { __iconData as iFiles } from 'lucide-react/dist/esm/icons/files.mjs'
import { __iconData as iFileCheck } from 'lucide-react/dist/esm/icons/file-check.mjs'
import { __iconData as iFilePlus } from 'lucide-react/dist/esm/icons/file-plus.mjs'
import { __iconData as iFolder } from 'lucide-react/dist/esm/icons/folder.mjs'
import { __iconData as iFolderOpen } from 'lucide-react/dist/esm/icons/folder-open.mjs'
import { __iconData as iFolderKanban } from 'lucide-react/dist/esm/icons/folder-kanban.mjs'
import { __iconData as iArchive } from 'lucide-react/dist/esm/icons/archive.mjs'
import { __iconData as iInbox } from 'lucide-react/dist/esm/icons/inbox.mjs'
import { __iconData as iClipboard } from 'lucide-react/dist/esm/icons/clipboard.mjs'
import { __iconData as iClipboardList } from 'lucide-react/dist/esm/icons/clipboard-list.mjs'
import { __iconData as iClipboardCheck } from 'lucide-react/dist/esm/icons/clipboard-check.mjs'
import { __iconData as iNotebookPen } from 'lucide-react/dist/esm/icons/notebook-pen.mjs'
import { __iconData as iNotebook } from 'lucide-react/dist/esm/icons/notebook.mjs'
import { __iconData as iBook } from 'lucide-react/dist/esm/icons/book.mjs'
import { __iconData as iBookOpen } from 'lucide-react/dist/esm/icons/book-open.mjs'
import { __iconData as iBookBookmark } from 'lucide-react/dist/esm/icons/book-bookmark.mjs'
import { __iconData as iLibrary } from 'lucide-react/dist/esm/icons/library.mjs'
import { __iconData as iNewspaper } from 'lucide-react/dist/esm/icons/newspaper.mjs'
import { __iconData as iStickyNote } from 'lucide-react/dist/esm/icons/sticky-note.mjs'
import { __iconData as iScrollText } from 'lucide-react/dist/esm/icons/scroll-text.mjs'
import { __iconData as iList } from 'lucide-react/dist/esm/icons/list.mjs'
import { __iconData as iListChecks } from 'lucide-react/dist/esm/icons/list-checks.mjs'
import { __iconData as iListTodo } from 'lucide-react/dist/esm/icons/list-todo.mjs'
import { __iconData as iTable } from 'lucide-react/dist/esm/icons/table.mjs'
import { __iconData as iDatabase } from 'lucide-react/dist/esm/icons/database.mjs'
import { __iconData as iLayers } from 'lucide-react/dist/esm/icons/layers.mjs'
import { __iconData as iLayoutDashboard } from 'lucide-react/dist/esm/icons/layout-dashboard.mjs'
import { __iconData as iKanban } from 'lucide-react/dist/esm/icons/kanban.mjs'
import { __iconData as iLink } from 'lucide-react/dist/esm/icons/link.mjs'
import { __iconData as iPaperclip } from 'lucide-react/dist/esm/icons/paperclip.mjs'
import { __iconData as iPrinter } from 'lucide-react/dist/esm/icons/printer.mjs'
import { __iconData as iSearch } from 'lucide-react/dist/esm/icons/search.mjs'
import { __iconData as iFunnel } from 'lucide-react/dist/esm/icons/funnel.mjs'
import { __iconData as iSlidersHorizontal } from 'lucide-react/dist/esm/icons/sliders-horizontal.mjs'
import { __iconData as iSettings } from 'lucide-react/dist/esm/icons/settings.mjs'
import { __iconData as iWrench } from 'lucide-react/dist/esm/icons/wrench.mjs'
import { __iconData as iHammer } from 'lucide-react/dist/esm/icons/hammer.mjs'
import { __iconData as iKey } from 'lucide-react/dist/esm/icons/key.mjs'
import { __iconData as iLock } from 'lucide-react/dist/esm/icons/lock.mjs'
import { __iconData as iLockOpen } from 'lucide-react/dist/esm/icons/lock-open.mjs'
import { __iconData as iShield } from 'lucide-react/dist/esm/icons/shield.mjs'
import { __iconData as iEye } from 'lucide-react/dist/esm/icons/eye.mjs'
import { __iconData as iEyeOff } from 'lucide-react/dist/esm/icons/eye-off.mjs'
import { __iconData as iPencil } from 'lucide-react/dist/esm/icons/pencil.mjs'
import { __iconData as iPenTool } from 'lucide-react/dist/esm/icons/pen-tool.mjs'
import { __iconData as iHighlighter } from 'lucide-react/dist/esm/icons/highlighter.mjs'
import { __iconData as iEraser } from 'lucide-react/dist/esm/icons/eraser.mjs'
import { __iconData as iScissors } from 'lucide-react/dist/esm/icons/scissors.mjs'
import { __iconData as iTrash } from 'lucide-react/dist/esm/icons/trash.mjs'
import { __iconData as iSave } from 'lucide-react/dist/esm/icons/save.mjs'
import { __iconData as iImage } from 'lucide-react/dist/esm/icons/image.mjs'
import { __iconData as iCamera } from 'lucide-react/dist/esm/icons/camera.mjs'
import { __iconData as iFilm } from 'lucide-react/dist/esm/icons/film.mjs'
import { __iconData as iMusic } from 'lucide-react/dist/esm/icons/music.mjs'
import { __iconData as iHeadphones } from 'lucide-react/dist/esm/icons/headphones.mjs'
import { __iconData as iCode } from 'lucide-react/dist/esm/icons/code.mjs'
import { __iconData as iCodeXml } from 'lucide-react/dist/esm/icons/code-xml.mjs'
import { __iconData as iTerminal } from 'lucide-react/dist/esm/icons/terminal.mjs'
import { __iconData as iBug } from 'lucide-react/dist/esm/icons/bug.mjs'
import { __iconData as iCpu } from 'lucide-react/dist/esm/icons/cpu.mjs'
import { __iconData as iServer } from 'lucide-react/dist/esm/icons/server.mjs'
import { __iconData as iCloud } from 'lucide-react/dist/esm/icons/cloud.mjs'
import { __iconData as iCloudUpload } from 'lucide-react/dist/esm/icons/cloud-upload.mjs'
import { __iconData as iWifi } from 'lucide-react/dist/esm/icons/wifi.mjs'
import { __iconData as iBluetooth } from 'lucide-react/dist/esm/icons/bluetooth.mjs'
import { __iconData as iBattery } from 'lucide-react/dist/esm/icons/battery.mjs'
import { __iconData as iPlug } from 'lucide-react/dist/esm/icons/plug.mjs'
import { __iconData as iPower } from 'lucide-react/dist/esm/icons/power.mjs'
import { __iconData as iMonitor } from 'lucide-react/dist/esm/icons/monitor.mjs'
import { __iconData as iLaptop } from 'lucide-react/dist/esm/icons/laptop.mjs'
import { __iconData as iSmartphone } from 'lucide-react/dist/esm/icons/smartphone.mjs'
import { __iconData as iTablet } from 'lucide-react/dist/esm/icons/tablet.mjs'
import { __iconData as iKeyboard } from 'lucide-react/dist/esm/icons/keyboard.mjs'
import { __iconData as iMousePointer } from 'lucide-react/dist/esm/icons/mouse-pointer.mjs'
import { __iconData as iGitBranch } from 'lucide-react/dist/esm/icons/git-branch.mjs'
import { __iconData as iGitMerge } from 'lucide-react/dist/esm/icons/git-merge.mjs'
import { __iconData as iGitPullRequest } from 'lucide-react/dist/esm/icons/git-pull-request.mjs'
import { __iconData as iWorkflow } from 'lucide-react/dist/esm/icons/workflow.mjs'
import { __iconData as iZap } from 'lucide-react/dist/esm/icons/zap.mjs'
import { __iconData as iBot } from 'lucide-react/dist/esm/icons/bot.mjs'
import { __iconData as iGlobe } from 'lucide-react/dist/esm/icons/globe.mjs'
import { __iconData as iQrCode } from 'lucide-react/dist/esm/icons/qr-code.mjs'
import { __iconData as iBinary } from 'lucide-react/dist/esm/icons/binary.mjs'
import { __iconData as iBraces } from 'lucide-react/dist/esm/icons/braces.mjs'
import { __iconData as iHouse } from 'lucide-react/dist/esm/icons/house.mjs'
import { __iconData as iMap } from 'lucide-react/dist/esm/icons/map.mjs'
import { __iconData as iMapPin } from 'lucide-react/dist/esm/icons/map-pin.mjs'
import { __iconData as iNavigation } from 'lucide-react/dist/esm/icons/navigation.mjs'
import { __iconData as iCompass } from 'lucide-react/dist/esm/icons/compass.mjs'
import { __iconData as iPlane } from 'lucide-react/dist/esm/icons/plane.mjs'
import { __iconData as iCar } from 'lucide-react/dist/esm/icons/car.mjs'
import { __iconData as iBike } from 'lucide-react/dist/esm/icons/bike.mjs'
import { __iconData as iTrainFront } from 'lucide-react/dist/esm/icons/train-front.mjs'
import { __iconData as iShip } from 'lucide-react/dist/esm/icons/ship.mjs'
import { __iconData as iEarth } from 'lucide-react/dist/esm/icons/earth.mjs'
import { __iconData as iMountain } from 'lucide-react/dist/esm/icons/mountain.mjs'
import { __iconData as iTreePine } from 'lucide-react/dist/esm/icons/tree-pine.mjs'
import { __iconData as iLeaf } from 'lucide-react/dist/esm/icons/leaf.mjs'
import { __iconData as iFlower } from 'lucide-react/dist/esm/icons/flower.mjs'
import { __iconData as iSun } from 'lucide-react/dist/esm/icons/sun.mjs'
import { __iconData as iMoon } from 'lucide-react/dist/esm/icons/moon.mjs'
import { __iconData as iCloudSun } from 'lucide-react/dist/esm/icons/cloud-sun.mjs'
import { __iconData as iCloudRain } from 'lucide-react/dist/esm/icons/cloud-rain.mjs'
import { __iconData as iSnowflake } from 'lucide-react/dist/esm/icons/snowflake.mjs'
import { __iconData as iUmbrella } from 'lucide-react/dist/esm/icons/umbrella.mjs'
import { __iconData as iFlame } from 'lucide-react/dist/esm/icons/flame.mjs'
import { __iconData as iDroplet } from 'lucide-react/dist/esm/icons/droplet.mjs'
import { __iconData as iThermometer } from 'lucide-react/dist/esm/icons/thermometer.mjs'
import { __iconData as iWind } from 'lucide-react/dist/esm/icons/wind.mjs'
import { __iconData as iRainbow } from 'lucide-react/dist/esm/icons/rainbow.mjs'
import { __iconData as iLightbulb } from 'lucide-react/dist/esm/icons/lightbulb.mjs'
import { __iconData as iBrain } from 'lucide-react/dist/esm/icons/brain.mjs'
import { __iconData as iGraduationCap } from 'lucide-react/dist/esm/icons/graduation-cap.mjs'
import { __iconData as iFlaskConical } from 'lucide-react/dist/esm/icons/flask-conical.mjs'
import { __iconData as iMicroscope } from 'lucide-react/dist/esm/icons/microscope.mjs'
import { __iconData as iPuzzle } from 'lucide-react/dist/esm/icons/puzzle.mjs'
import { __iconData as iPalette } from 'lucide-react/dist/esm/icons/palette.mjs'
import { __iconData as iBrush } from 'lucide-react/dist/esm/icons/brush.mjs'
import { __iconData as iCoffee } from 'lucide-react/dist/esm/icons/coffee.mjs'
import { __iconData as iUtensils } from 'lucide-react/dist/esm/icons/utensils.mjs'
import { __iconData as iPizza } from 'lucide-react/dist/esm/icons/pizza.mjs'
import { __iconData as iApple } from 'lucide-react/dist/esm/icons/apple.mjs'
import { __iconData as iBeer } from 'lucide-react/dist/esm/icons/beer.mjs'
import { __iconData as iWine } from 'lucide-react/dist/esm/icons/wine.mjs'
import { __iconData as iCake } from 'lucide-react/dist/esm/icons/cake.mjs'
import { __iconData as iCookie } from 'lucide-react/dist/esm/icons/cookie.mjs'
import { __iconData as iDumbbell } from 'lucide-react/dist/esm/icons/dumbbell.mjs'
import { __iconData as iHeartPulse } from 'lucide-react/dist/esm/icons/heart-pulse.mjs'
import { __iconData as iPill } from 'lucide-react/dist/esm/icons/pill.mjs'
import { __iconData as iStethoscope } from 'lucide-react/dist/esm/icons/stethoscope.mjs'
import { __iconData as iActivity } from 'lucide-react/dist/esm/icons/activity.mjs'
import { __iconData as iGamepad2 } from 'lucide-react/dist/esm/icons/gamepad-2.mjs'
import { __iconData as iDice5 } from 'lucide-react/dist/esm/icons/dice-5.mjs'
import { __iconData as iGhost } from 'lucide-react/dist/esm/icons/ghost.mjs'
import { __iconData as iSkull } from 'lucide-react/dist/esm/icons/skull.mjs'
import { __iconData as iCat } from 'lucide-react/dist/esm/icons/cat.mjs'
import { __iconData as iDog } from 'lucide-react/dist/esm/icons/dog.mjs'
import { __iconData as iBird } from 'lucide-react/dist/esm/icons/bird.mjs'
import { __iconData as iFish } from 'lucide-react/dist/esm/icons/fish.mjs'
import { __iconData as iPawPrint } from 'lucide-react/dist/esm/icons/paw-print.mjs'
import { __iconData as iAnchor } from 'lucide-react/dist/esm/icons/anchor.mjs'
import { __iconData as iInfinity } from 'lucide-react/dist/esm/icons/infinity.mjs'
import { __iconData as iAtom } from 'lucide-react/dist/esm/icons/atom.mjs'
import { __iconData as iMagnet } from 'lucide-react/dist/esm/icons/magnet.mjs'
import { __iconData as iBox } from 'lucide-react/dist/esm/icons/box.mjs'
import { __iconData as iBoxes } from 'lucide-react/dist/esm/icons/boxes.mjs'
import { __iconData as iMailbox } from 'lucide-react/dist/esm/icons/mailbox.mjs'
import { __iconData as iMilestone } from 'lucide-react/dist/esm/icons/milestone.mjs'
import { __iconData as iRuler } from 'lucide-react/dist/esm/icons/ruler.mjs'
import { __iconData as iGem } from 'lucide-react/dist/esm/icons/gem.mjs'

export interface GlyphEntry {
  name: string
  node: LucideIconNode[]
  /** Search words: the name's words, English tags, German tags. */
  words: string
  /** lucide's older names for the same icon ("trash-2" → trash) */
  aliases: string[]
}

const g = (name: string, data: LucideIconData, en: string, de: string): GlyphEntry => ({
  name,
  node: data.node,
  words: `${name.replace(/-/g, ' ')} ${en} ${de}`,
  aliases: data.aliases ?? [],
})

export const GLYPHS: GlyphEntry[] = [
  // status & marks
  g('check', iCheck, 'tick done ok yes correct', 'haken erledigt ok ja richtig'),
  g('check-check', iCheckCheck, 'done read double tick', 'erledigt gelesen doppelt'),
  g('circle-check', iCircleCheck, 'done success ok approved', 'erledigt erfolg ok genehmigt'),
  g('circle-x', iCircleX, 'error fail no cancel', 'fehler abgelehnt nein abbrechen'),
  g('x', iX, 'close cancel no wrong delete', 'schließen abbrechen nein falsch'),
  g('circle-alert', iCircleAlert, 'warning attention error', 'warnung achtung fehler'),
  g('triangle-alert', iTriangleAlert, 'warning caution danger', 'warnung vorsicht gefahr'),
  g('octagon-alert', iOctagonAlert, 'stop error critical', 'stopp fehler kritisch'),
  g('info', iInfo, 'information note about', 'information hinweis'),
  g('circle-question-mark', iCircleQuestionMark, 'help question faq', 'hilfe frage'),
  g('ban', iBan, 'forbidden blocked no', 'verboten gesperrt'),
  g('circle-dot', iCircleDot, 'record active radio', 'aktiv aufnahme'),
  g('circle', iCircle, 'dot round empty', 'kreis punkt leer'),
  g('square', iSquare, 'box empty', 'quadrat kasten leer'),
  g('square-check', iSquareCheck, 'checkbox done task', 'checkbox erledigt aufgabe'),
  g('circle-plus', iCirclePlus, 'add new', 'hinzufügen neu plus'),
  g('circle-minus', iCircleMinus, 'remove less', 'entfernen minus'),
  g('plus', iPlus, 'add new more', 'hinzufügen neu mehr'),
  g('minus', iMinus, 'remove less dash', 'entfernen weniger'),
  g('shield-check', iShieldCheck, 'secure safe verified', 'sicher geprüft schutz'),
  g('badge-check', iBadgeCheck, 'verified approved quality', 'geprüft bestätigt qualität'),
  g('thumbs-up', iThumbsUp, 'like good yes approve', 'daumen gut ja gefällt'),
  g('thumbs-down', iThumbsDown, 'dislike bad no', 'daumen schlecht nein'),
  g('flag', iFlag, 'milestone report goal', 'flagge meilenstein ziel'),
  g('bookmark', iBookmark, 'save later', 'lesezeichen merken'),
  g('pin', iPin, 'pinned important', 'pinnwand angeheftet wichtig'),
  g('star', iStar, 'favorite rating important', 'stern favorit bewertung'),
  g('heart', iHeart, 'love like favorite', 'herz liebe gefällt'),
  g('sparkle', iSparkle, 'shine new highlight', 'funkeln neu highlight'),
  // arrows
  g('arrow-right', iArrowRight, 'next forward go', 'pfeil rechts weiter'),
  g('arrow-left', iArrowLeft, 'back previous', 'pfeil links zurück'),
  g('arrow-up', iArrowUp, 'up top increase', 'pfeil hoch oben'),
  g('arrow-down', iArrowDown, 'down bottom decrease', 'pfeil runter unten'),
  g('arrow-up-right', iArrowUpRight, 'external growth diagonal', 'pfeil diagonal wachstum'),
  g('arrow-down-right', iArrowDownRight, 'decline diagonal', 'pfeil diagonal rückgang'),
  g('arrow-right-left', iArrowRightLeft, 'swap exchange transfer', 'tausch wechsel'),
  g('move-right', iMoveRight, 'move next', 'verschieben weiter'),
  g('chevron-right', iChevronRight, 'next more caret', 'weiter mehr'),
  g('chevron-left', iChevronLeft, 'back previous caret', 'zurück'),
  g('chevron-up', iChevronUp, 'up collapse caret', 'hoch einklappen'),
  g('chevron-down', iChevronDown, 'down expand caret', 'runter aufklappen'),
  g('chevrons-right', iChevronsRight, 'fast forward skip', 'vorspulen überspringen'),
  g('corner-down-right', iCornerDownRight, 'reply sub item indent', 'antwort unterpunkt einrücken'),
  g('redo-2', iRedo2, 'redo again', 'wiederholen'),
  g('undo-2', iUndo2, 'undo back', 'rückgängig'),
  g('refresh-cw', iRefreshCw, 'refresh reload sync update', 'aktualisieren neu laden'),
  g('rotate-cw', iRotateCw, 'rotate turn', 'drehen'),
  g('repeat', iRepeat, 'loop recurring again', 'wiederholen schleife wiederkehrend'),
  g('shuffle', iShuffle, 'random mix', 'zufall mischen'),
  g('trending-up', iTrendingUp, 'growth increase chart', 'wachstum anstieg trend'),
  g('trending-down', iTrendingDown, 'decline decrease chart', 'rückgang abnahme trend'),
  g('external-link', iExternalLink, 'open link new window', 'link öffnen extern'),
  g('log-in', iLogIn, 'sign in enter', 'anmelden eintreten'),
  g('log-out', iLogOut, 'sign out leave exit', 'abmelden verlassen'),
  g('download', iDownload, 'save get', 'herunterladen speichern'),
  g('upload', iUpload, 'send put', 'hochladen'),
  g('share-2', iShare2, 'share network', 'teilen'),
  g('forward', iForward, 'forward send on', 'weiterleiten'),
  g('reply', iReply, 'answer respond', 'antworten'),
  // time
  g('clock', iClock, 'time hour', 'uhr zeit stunde'),
  g('alarm-clock', iAlarmClock, 'alarm wake reminder', 'wecker alarm erinnerung'),
  g('timer', iTimer, 'stopwatch countdown duration', 'stoppuhr dauer'),
  g('hourglass', iHourglass, 'wait pending time', 'sanduhr warten ausstehend'),
  g('calendar', iCalendar, 'date day schedule', 'kalender datum termin'),
  g('calendar-days', iCalendarDays, 'date week schedule', 'kalender woche termine'),
  g('calendar-check', iCalendarCheck, 'scheduled booked done', 'termin gebucht bestätigt'),
  g('calendar-clock', iCalendarClock, 'appointment deadline', 'termin frist'),
  g('rotate-ccw-clock', iRotateCcwClock, 'history past recent log', 'verlauf vergangenheit'),
  g('watch', iWatch, 'time wrist', 'armbanduhr zeit'),
  g('sunrise', iSunrise, 'morning start', 'sonnenaufgang morgen'),
  g('sunset', iSunset, 'evening end', 'sonnenuntergang abend'),
  // people & communication
  g('user', iUser, 'person profile account', 'person profil konto nutzer'),
  g('users', iUsers, 'team people group', 'team personen gruppe leute'),
  g('user-plus', iUserPlus, 'invite add member', 'einladen mitglied hinzufügen'),
  g('user-check', iUserCheck, 'assigned approved person', 'zugewiesen bestätigt person'),
  g('contact', iContact, 'card address crm', 'kontakt visitenkarte crm'),
  g('face-slightly-smiling', iFaceSlightlySmiling, 'smile happy good emoji', 'lächeln glücklich gut'),
  g('face-slightly-frowning', iFaceSlightlyFrowning, 'frown sad bad', 'traurig schlecht'),
  g('face-neutral', iFaceNeutral, 'meh neutral okay', 'neutral naja'),
  g('face-grinning', iFaceGrinning, 'laugh funny joy', 'lachen lustig freude'),
  g('message-square', iMessageSquare, 'comment chat note', 'nachricht kommentar chat'),
  g('message-circle', iMessageCircle, 'chat talk bubble', 'nachricht sprechblase chat'),
  g('messages-square', iMessagesSquare, 'conversation discussion', 'unterhaltung diskussion'),
  g('mail', iMail, 'email letter inbox', 'mail brief post'),
  g('send', iSend, 'submit paper plane', 'senden abschicken'),
  g('phone', iPhone, 'call telephone', 'telefon anruf'),
  g('video', iVideo, 'camera call meeting', 'video kamera anruf'),
  g('mic', iMic, 'microphone voice podcast', 'mikrofon stimme podcast'),
  g('megaphone', iMegaphone, 'announce marketing loud', 'megafon ankündigung marketing'),
  g('bell', iBell, 'notification reminder alert', 'glocke benachrichtigung erinnerung'),
  g('bell-ring', iBellRing, 'alarm notification ringing', 'klingeln benachrichtigung'),
  g('at-sign', iAtSign, 'mention email at', 'erwähnung at'),
  g('hash', iHash, 'tag number channel', 'hashtag nummer kanal'),
  g('quote', iQuote, 'citation saying', 'zitat'),
  g('handshake', iHandshake, 'deal partner agreement', 'handschlag partner vertrag'),
  g('hand', iHand, 'stop wave hello', 'hand stopp hallo'),
  g('party-popper', iPartyPopper, 'celebrate party launch', 'feiern party'),
  g('baby', iBaby, 'child new', 'baby kind'),
  g('person-standing', iPersonStanding, 'person human individual', 'person mensch'),
  // work & business
  g('briefcase', iBriefcase, 'work job business', 'aktenkoffer arbeit job'),
  g('building-complex', iBuildingComplex, 'building company office', 'gebäude firma büro'),
  g('landmark', iLandmark, 'bank government institution', 'bank behörde'),
  g('store', iStore, 'shop retail', 'laden geschäft'),
  g('shopping-cart', iShoppingCart, 'cart buy shop', 'einkaufswagen kaufen'),
  g('shopping-bag', iShoppingBag, 'bag buy purchase', 'einkaufstasche kaufen'),
  g('package', iPackage, 'box product delivery', 'paket produkt lieferung'),
  g('truck', iTruck, 'delivery shipping logistics', 'lkw lieferung logistik'),
  g('wallet', iWallet, 'money finance', 'geldbörse finanzen'),
  g('credit-card', iCreditCard, 'payment card', 'kreditkarte zahlung'),
  g('banknote', iBanknote, 'money cash', 'geldschein bargeld'),
  g('coins', iCoins, 'money budget', 'münzen geld budget'),
  g('receipt', iReceipt, 'invoice bill', 'rechnung beleg quittung'),
  g('piggy-bank', iPiggyBank, 'savings budget', 'sparschwein sparen'),
  g('circle-dollar-sign', iCircleDollarSign, 'money dollar revenue', 'geld dollar umsatz'),
  g('euro', iEuro, 'money currency', 'euro geld währung'),
  g('chart-line', iChartLine, 'chart graph growth', 'diagramm kurve'),
  g('chart-column', iChartColumn, 'chart bars statistics', 'diagramm balken statistik'),
  g('chart-pie', iChartPie, 'chart share pie', 'kuchendiagramm anteile'),
  g('chart-bar', iChartBar, 'chart bars ranking', 'balkendiagramm'),
  g('gauge', iGauge, 'speed meter kpi', 'messgerät tacho kennzahl'),
  g('target', iTarget, 'goal focus aim okr', 'ziel zielscheibe fokus'),
  g('trophy', iTrophy, 'win award success', 'pokal sieg erfolg'),
  g('award', iAward, 'prize badge', 'auszeichnung preis'),
  g('medal', iMedal, 'winner first', 'medaille gewinner'),
  g('crown', iCrown, 'king best premium', 'krone bester premium'),
  g('rocket', iRocket, 'launch start fast', 'rakete start launch'),
  g('presentation', iPresentation, 'slides talk', 'präsentation vortrag'),
  g('scale', iScale, 'legal balance law', 'waage recht gesetz'),
  g('calculator', iCalculator, 'math budget', 'rechner budget'),
  g('percent', iPercent, 'discount rate', 'prozent rabatt'),
  g('tag', iTag, 'label price', 'etikett schild preis'),
  g('tags', iTags, 'labels', 'etiketten schlagwörter'),
  g('ticket', iTicket, 'event pass', 'ticket eintritt'),
  g('gift', iGift, 'present bonus', 'geschenk'),
  // documents & tools
  g('file', iFile, 'document', 'datei dokument'),
  g('file-text', iFileText, 'document text page', 'datei dokument text'),
  g('files', iFiles, 'documents copies', 'dateien dokumente'),
  g('file-check', iFileCheck, 'approved document', 'geprüft dokument'),
  g('file-plus', iFilePlus, 'new document', 'neues dokument'),
  g('folder', iFolder, 'directory', 'ordner verzeichnis'),
  g('folder-open', iFolderOpen, 'directory open', 'ordner offen'),
  g('folder-kanban', iFolderKanban, 'projects board', 'projekte board ordner'),
  g('archive', iArchive, 'box storage', 'archiv ablage'),
  g('inbox', iInbox, 'tray incoming', 'eingang posteingang'),
  g('clipboard', iClipboard, 'paste board', 'klemmbrett'),
  g('clipboard-list', iClipboardList, 'checklist list', 'klemmbrett liste'),
  g('clipboard-check', iClipboardCheck, 'done review', 'erledigt geprüft'),
  g('notebook-pen', iNotebookPen, 'notes journal', 'notizbuch notizen'),
  g('notebook', iNotebook, 'notes journal', 'notizbuch'),
  g('book', iBook, 'read manual', 'buch lesen handbuch'),
  g('book-open', iBookOpen, 'read docs wiki', 'buch lesen doku wiki'),
  g('book-bookmark', iBookBookmark, 'book marked bookmark reading', 'lesezeichen buch'),
  g('library', iLibrary, 'books collection', 'bibliothek bücher'),
  g('newspaper', iNewspaper, 'news press article', 'zeitung nachrichten presse'),
  g('sticky-note', iStickyNote, 'note memo', 'notizzettel memo'),
  g('scroll-text', iScrollText, 'contract script', 'schriftrolle vertrag'),
  g('list', iList, 'items bullet', 'liste'),
  g('list-checks', iListChecks, 'checklist tasks', 'checkliste aufgaben'),
  g('list-todo', iListTodo, 'todo tasks', 'todo aufgaben'),
  g('table', iTable, 'grid sheet', 'tabelle'),
  g('database', iDatabase, 'data storage', 'datenbank daten'),
  g('layers', iLayers, 'stack levels', 'ebenen schichten'),
  g('layout-dashboard', iLayoutDashboard, 'dashboard overview', 'dashboard übersicht'),
  g('kanban', iKanban, 'board columns', 'kanban board'),
  g('link', iLink, 'url chain', 'link verknüpfung'),
  g('paperclip', iPaperclip, 'attachment', 'büroklammer anhang'),
  g('printer', iPrinter, 'print', 'drucker drucken'),
  g('search', iSearch, 'find magnifier', 'suche lupe finden'),
  g('funnel', iFunnel, 'filter funnel sort', 'filter trichter'),
  g('sliders-horizontal', iSlidersHorizontal, 'settings controls adjust', 'regler einstellungen'),
  g('settings', iSettings, 'gear preferences', 'einstellungen zahnrad'),
  g('wrench', iWrench, 'tool fix repair', 'schraubenschlüssel werkzeug reparieren'),
  g('hammer', iHammer, 'tool build', 'hammer werkzeug bauen'),
  g('key', iKey, 'password access', 'schlüssel passwort zugang'),
  g('lock', iLock, 'private secure locked', 'schloss privat gesperrt'),
  g('lock-open', iLockOpen, 'unlocked open public', 'offen entsperrt öffentlich'),
  g('shield', iShield, 'security protection', 'schild sicherheit schutz'),
  g('eye', iEye, 'view visible watch', 'auge sichtbar ansehen'),
  g('eye-off', iEyeOff, 'hidden invisible', 'versteckt unsichtbar'),
  g('pencil', iPencil, 'edit write', 'stift bearbeiten schreiben'),
  g('pen-tool', iPenTool, 'design vector', 'zeichenstift design'),
  g('highlighter', iHighlighter, 'marker highlight', 'textmarker markieren'),
  g('eraser', iEraser, 'delete clear', 'radiergummi löschen'),
  g('scissors', iScissors, 'cut', 'schere schneiden'),
  g('trash', iTrash, 'trash bin delete bin remove', 'papierkorb löschen'),
  g('save', iSave, 'disk store', 'speichern diskette'),
  g('image', iImage, 'picture photo', 'bild foto'),
  g('camera', iCamera, 'photo picture', 'kamera foto'),
  g('film', iFilm, 'movie video', 'film video'),
  g('music', iMusic, 'song audio', 'musik lied'),
  g('headphones', iHeadphones, 'audio listen', 'kopfhörer hören'),
  // tech
  g('code', iCode, 'develop programming', 'code entwicklung programmieren'),
  g('code-xml', iCodeXml, 'html markup', 'html code'),
  g('terminal', iTerminal, 'console shell command', 'terminal konsole befehl'),
  g('bug', iBug, 'error issue defect', 'fehler bug käfer'),
  g('cpu', iCpu, 'processor chip hardware', 'prozessor chip'),
  g('server', iServer, 'backend host', 'server'),
  g('cloud', iCloud, 'online storage', 'wolke cloud'),
  g('cloud-upload', iCloudUpload, 'backup upload', 'hochladen sicherung'),
  g('wifi', iWifi, 'internet wireless network', 'wlan internet netzwerk'),
  g('bluetooth', iBluetooth, 'wireless', 'bluetooth funk'),
  g('battery', iBattery, 'power energy charge', 'akku batterie energie'),
  g('plug', iPlug, 'power connect integration', 'stecker anschluss integration'),
  g('power', iPower, 'on off', 'ein aus strom'),
  g('monitor', iMonitor, 'screen desktop', 'bildschirm monitor'),
  g('laptop', iLaptop, 'computer notebook', 'laptop computer'),
  g('smartphone', iSmartphone, 'mobile phone', 'handy smartphone'),
  g('tablet', iTablet, 'ipad device', 'tablet gerät'),
  g('keyboard', iKeyboard, 'type keys', 'tastatur tippen'),
  g('mouse-pointer', iMousePointer, 'cursor click', 'mauszeiger klick'),
  g('git-branch', iGitBranch, 'branch version', 'branch zweig version'),
  g('git-merge', iGitMerge, 'merge combine', 'zusammenführen'),
  g('git-pull-request', iGitPullRequest, 'review pull request', 'review änderung'),
  g('workflow', iWorkflow, 'process flow automation', 'ablauf prozess automation'),
  g('zap', iZap, 'fast power automation lightning', 'blitz schnell automation'),
  g('bot', iBot, 'robot assistant automation', 'roboter assistent'),
  g('globe', iGlobe, 'world web international', 'welt web international'),
  g('qr-code', iQrCode, 'scan code', 'qr code scannen'),
  g('binary', iBinary, 'data bits', 'binär daten'),
  g('braces', iBraces, 'json code object', 'klammern json'),
  // places & nature
  g('house', iHouse, 'home start', 'haus zuhause start'),
  g('map', iMap, 'roadmap location', 'karte roadmap'),
  g('map-pin', iMapPin, 'location place address', 'ort standort adresse'),
  g('navigation', iNavigation, 'direction gps', 'navigation richtung'),
  g('compass', iCompass, 'direction orientation onboarding', 'kompass richtung orientierung'),
  g('plane', iPlane, 'travel flight', 'flugzeug reise flug'),
  g('car', iCar, 'drive vehicle', 'auto fahren'),
  g('bike', iBike, 'bicycle cycle', 'fahrrad'),
  g('train-front', iTrainFront, 'rail travel', 'zug bahn reise'),
  g('ship', iShip, 'boat sea shipping', 'schiff boot'),
  g('earth', iEarth, 'world planet global', 'erde welt planet'),
  g('mountain', iMountain, 'peak hike', 'berg gipfel'),
  g('tree-pine', iTreePine, 'nature forest', 'baum wald natur'),
  g('leaf', iLeaf, 'nature green eco', 'blatt natur öko'),
  g('flower', iFlower, 'nature spring', 'blume blüte'),
  g('sun', iSun, 'day light weather', 'sonne tag wetter'),
  g('moon', iMoon, 'night dark', 'mond nacht'),
  g('cloud-sun', iCloudSun, 'weather partly cloudy', 'wetter bewölkt'),
  g('cloud-rain', iCloudRain, 'rain weather', 'regen wetter'),
  g('snowflake', iSnowflake, 'winter cold snow', 'schneeflocke winter kalt'),
  g('umbrella', iUmbrella, 'rain insurance', 'regenschirm schirm'),
  g('flame', iFlame, 'fire hot trending', 'flamme feuer heiß'),
  g('droplet', iDroplet, 'water liquid', 'tropfen wasser'),
  g('thermometer', iThermometer, 'temperature heat', 'thermometer temperatur'),
  g('wind', iWind, 'air breeze', 'wind luft'),
  g('rainbow', iRainbow, 'colors pride', 'regenbogen'),
  // objects & misc
  g('lightbulb', iLightbulb, 'idea tip insight', 'glühbirne idee tipp'),
  g('brain', iBrain, 'think knowledge mind', 'gehirn wissen denken'),
  g('graduation-cap', iGraduationCap, 'learn course school', 'lernen kurs schule'),
  g('flask-conical', iFlaskConical, 'experiment lab test', 'labor experiment test'),
  g('microscope', iMicroscope, 'research science', 'mikroskop forschung'),
  g('puzzle', iPuzzle, 'plugin integration piece', 'puzzle erweiterung'),
  g('palette', iPalette, 'design color art', 'palette design farbe'),
  g('brush', iBrush, 'paint design', 'pinsel malen'),
  g('coffee', iCoffee, 'break cafe', 'kaffee pause'),
  g('utensils', iUtensils, 'food lunch restaurant', 'besteck essen mittag'),
  g('pizza', iPizza, 'food party', 'pizza essen'),
  g('apple', iApple, 'fruit health', 'apfel obst'),
  g('beer', iBeer, 'drink party', 'bier trinken'),
  g('wine', iWine, 'drink dinner', 'wein trinken'),
  g('cake', iCake, 'birthday celebrate', 'kuchen geburtstag'),
  g('cookie', iCookie, 'snack', 'keks'),
  g('dumbbell', iDumbbell, 'fitness gym workout', 'hantel fitness training'),
  g('heart-pulse', iHeartPulse, 'health heartbeat', 'gesundheit puls'),
  g('pill', iPill, 'medicine health', 'tablette medizin'),
  g('stethoscope', iStethoscope, 'doctor medical', 'arzt medizin'),
  g('activity', iActivity, 'pulse metrics monitor', 'aktivität puls'),
  g('gamepad-2', iGamepad2, 'game play', 'spiel controller'),
  g('dice-5', iDice5, 'random game chance', 'würfel spiel zufall'),
  g('ghost', iGhost, 'spooky empty', 'geist'),
  g('skull', iSkull, 'danger dead', 'totenkopf gefahr'),
  g('cat', iCat, 'pet animal', 'katze haustier tier'),
  g('dog', iDog, 'pet animal', 'hund haustier tier'),
  g('bird', iBird, 'animal tweet', 'vogel tier'),
  g('fish', iFish, 'animal sea', 'fisch tier'),
  g('paw-print', iPawPrint, 'pet animal', 'pfote tier'),
  g('anchor', iAnchor, 'harbor stable', 'anker hafen'),
  g('infinity', iInfinity, 'forever loop', 'unendlich'),
  g('atom', iAtom, 'science physics', 'atom wissenschaft'),
  g('magnet', iMagnet, 'attract', 'magnet anziehen'),
  g('box', iBox, 'package container', 'kiste box'),
  g('boxes', iBoxes, 'inventory modules', 'kisten module lager'),
  g('mailbox', iMailbox, 'post letters', 'briefkasten post'),
  g('milestone', iMilestone, 'signpost roadmap', 'meilenstein wegweiser'),
  g('ruler', iRuler, 'measure size', 'lineal messen'),
  g('gem', iGem, 'diamond value premium', 'edelstein diamant wert'),
]

/** Glyph by name — lucide's aliases included, so Markdown written with an older name still resolves. */
export const GLYPH_BY_NAME: ReadonlyMap<string, GlyphEntry> = new Map([...GLYPHS.flatMap((x) => x.aliases.map((a) => [a, x] as const)), ...GLYPHS.map((x) => [x.name, x] as const)])
