/**
 * Flag state from the MMSI's Maritime Identification Digits (first three
 * digits, ITU assignment). Deliberately partial: the major flag states and
 * open registries that cover the overwhelming share of AIS traffic; unknown
 * prefixes return null and the panel just omits the row.
 *
 * Each entry carries the HUD display name and the ISO 3166-1 alpha-2 code
 * used to derive the flag emoji. Territories map to their own ISO codes
 * where they exist (Faroe→FO, Gibraltar→GI, …); French Southern territories
 * (Adelie Land, Crozet, Kerguelen, St. Paul & Amsterdam) map to TF, and
 * Ascension uses the exceptionally-reserved AC.
 */

export const MID_COUNTRIES: Record<number, readonly [name: string, iso2: string]> = {
  201: ['Albania', 'AL'], 203: ['Austria', 'AT'], 205: ['Belgium', 'BE'],
  209: ['Cyprus', 'CY'], 210: ['Cyprus', 'CY'], 211: ['Germany', 'DE'],
  212: ['Cyprus', 'CY'], 215: ['Malta', 'MT'], 218: ['Germany', 'DE'],
  219: ['Denmark', 'DK'], 220: ['Denmark', 'DK'], 224: ['Spain', 'ES'],
  225: ['Spain', 'ES'], 226: ['France', 'FR'], 227: ['France', 'FR'],
  228: ['France', 'FR'], 229: ['Malta', 'MT'], 230: ['Finland', 'FI'],
  231: ['Faroe Islands', 'FO'], 232: ['UK', 'GB'], 233: ['UK', 'GB'],
  234: ['UK', 'GB'], 235: ['UK', 'GB'], 236: ['Gibraltar', 'GI'],
  237: ['Greece', 'GR'], 238: ['Croatia', 'HR'], 239: ['Greece', 'GR'],
  240: ['Greece', 'GR'], 241: ['Greece', 'GR'], 242: ['Morocco', 'MA'],
  243: ['Hungary', 'HU'], 244: ['Netherlands', 'NL'], 245: ['Netherlands', 'NL'],
  246: ['Netherlands', 'NL'], 247: ['Italy', 'IT'], 248: ['Malta', 'MT'],
  249: ['Malta', 'MT'], 250: ['Ireland', 'IE'], 251: ['Iceland', 'IS'],
  253: ['Luxembourg', 'LU'], 255: ['Madeira (PT)', 'PT'], 256: ['Malta', 'MT'],
  257: ['Norway', 'NO'], 258: ['Norway', 'NO'], 259: ['Norway', 'NO'],
  261: ['Poland', 'PL'], 263: ['Portugal', 'PT'], 264: ['Romania', 'RO'],
  265: ['Sweden', 'SE'], 266: ['Sweden', 'SE'], 267: ['Slovakia', 'SK'],
  268: ['San Marino', 'SM'], 269: ['Switzerland', 'CH'], 271: ['Turkey', 'TR'],
  272: ['Ukraine', 'UA'], 273: ['Russia', 'RU'], 274: ['North Macedonia', 'MK'],
  275: ['Latvia', 'LV'], 276: ['Estonia', 'EE'], 277: ['Lithuania', 'LT'],
  278: ['Slovenia', 'SI'], 279: ['Serbia', 'RS'], 301: ['Anguilla', 'AI'],
  303: ['USA (Alaska)', 'US'], 304: ['Antigua & Barbuda', 'AG'],
  305: ['Antigua & Barbuda', 'AG'], 306: ['Curaçao', 'CW'],
  308: ['Bahamas', 'BS'], 309: ['Bahamas', 'BS'], 310: ['Bermuda', 'BM'],
  311: ['Bahamas', 'BS'], 312: ['Belize', 'BZ'], 314: ['Barbados', 'BB'],
  316: ['Canada', 'CA'], 319: ['Cayman Islands', 'KY'], 325: ['Dominica', 'DM'],
  327: ['Dominican Rep.', 'DO'], 329: ['Guadeloupe', 'GP'], 330: ['Grenada', 'GD'],
  331: ['Greenland', 'GL'], 332: ['Guatemala', 'GT'], 334: ['Honduras', 'HN'],
  336: ['Haiti', 'HT'], 338: ['USA', 'US'], 339: ['Jamaica', 'JM'],
  341: ['St. Kitts & Nevis', 'KN'], 343: ['St. Lucia', 'LC'],
  345: ['Mexico', 'MX'], 347: ['Martinique', 'MQ'], 348: ['Montserrat', 'MS'],
  350: ['Nicaragua', 'NI'], 351: ['Panama', 'PA'], 352: ['Panama', 'PA'],
  353: ['Panama', 'PA'], 354: ['Panama', 'PA'], 355: ['Panama', 'PA'],
  356: ['Panama', 'PA'], 357: ['Panama', 'PA'], 358: ['Puerto Rico', 'PR'],
  359: ['El Salvador', 'SV'], 361: ['St. Pierre & Miquelon', 'PM'],
  362: ['Trinidad & Tobago', 'TT'], 364: ['Turks & Caicos', 'TC'],
  366: ['USA', 'US'], 367: ['USA', 'US'], 368: ['USA', 'US'], 369: ['USA', 'US'],
  370: ['Panama', 'PA'], 371: ['Panama', 'PA'], 372: ['Panama', 'PA'],
  373: ['Panama', 'PA'], 374: ['Panama', 'PA'], 375: ['St. Vincent', 'VC'],
  376: ['St. Vincent', 'VC'], 377: ['St. Vincent', 'VC'],
  378: ['British Virgin Is.', 'VG'], 379: ['US Virgin Is.', 'VI'],
  401: ['Afghanistan', 'AF'], 403: ['Saudi Arabia', 'SA'],
  405: ['Bangladesh', 'BD'], 408: ['Bahrain', 'BH'], 410: ['Bhutan', 'BT'],
  412: ['China', 'CN'], 413: ['China', 'CN'], 414: ['China', 'CN'],
  416: ['Taiwan', 'TW'], 417: ['Sri Lanka', 'LK'], 419: ['India', 'IN'],
  422: ['Iran', 'IR'], 425: ['Iraq', 'IQ'], 428: ['Israel', 'IL'],
  431: ['Japan', 'JP'], 432: ['Japan', 'JP'], 434: ['Turkmenistan', 'TM'],
  436: ['Kazakhstan', 'KZ'], 437: ['Uzbekistan', 'UZ'], 438: ['Jordan', 'JO'],
  440: ['South Korea', 'KR'], 441: ['South Korea', 'KR'],
  443: ['Palestine', 'PS'], 445: ['North Korea', 'KP'], 447: ['Kuwait', 'KW'],
  450: ['Lebanon', 'LB'], 451: ['Kyrgyzstan', 'KG'], 453: ['Macao', 'MO'],
  455: ['Maldives', 'MV'], 457: ['Mongolia', 'MN'], 459: ['Nepal', 'NP'],
  461: ['Oman', 'OM'], 463: ['Pakistan', 'PK'], 466: ['Qatar', 'QA'],
  468: ['Syria', 'SY'], 470: ['UAE', 'AE'], 471: ['UAE', 'AE'],
  472: ['Tajikistan', 'TJ'], 473: ['Yemen', 'YE'], 475: ['Yemen', 'YE'],
  477: ['Hong Kong', 'HK'], 478: ['Bosnia & Herzegovina', 'BA'],
  501: ['Adelie Land (FR)', 'TF'], 503: ['Australia', 'AU'],
  506: ['Myanmar', 'MM'], 508: ['Brunei', 'BN'], 510: ['Micronesia', 'FM'],
  511: ['Palau', 'PW'], 512: ['New Zealand', 'NZ'], 514: ['Cambodia', 'KH'],
  515: ['Cambodia', 'KH'], 516: ['Christmas Is.', 'CX'],
  518: ['Cook Islands', 'CK'], 520: ['Fiji', 'FJ'], 523: ['Cocos Islands', 'CC'],
  525: ['Indonesia', 'ID'], 529: ['Kiribati', 'KI'], 531: ['Laos', 'LA'],
  533: ['Malaysia', 'MY'], 536: ['N. Mariana Is.', 'MP'],
  538: ['Marshall Islands', 'MH'], 540: ['New Caledonia', 'NC'],
  542: ['Niue', 'NU'], 544: ['Nauru', 'NR'], 546: ['French Polynesia', 'PF'],
  548: ['Philippines', 'PH'], 550: ['East Timor', 'TL'],
  553: ['Papua New Guinea', 'PG'], 555: ['Pitcairn', 'PN'],
  557: ['Solomon Islands', 'SB'], 559: ['American Samoa', 'AS'],
  561: ['Samoa', 'WS'], 563: ['Singapore', 'SG'], 564: ['Singapore', 'SG'],
  565: ['Singapore', 'SG'], 566: ['Singapore', 'SG'], 567: ['Thailand', 'TH'],
  570: ['Tonga', 'TO'], 572: ['Tuvalu', 'TV'], 574: ['Vietnam', 'VN'],
  576: ['Vanuatu', 'VU'], 577: ['Vanuatu', 'VU'], 578: ['Wallis & Futuna', 'WF'],
  601: ['South Africa', 'ZA'], 603: ['Angola', 'AO'], 605: ['Algeria', 'DZ'],
  607: ['St. Paul & Amsterdam', 'TF'], 608: ['Ascension', 'AC'],
  609: ['Burundi', 'BI'], 610: ['Benin', 'BJ'], 611: ['Botswana', 'BW'],
  612: ['Cen. African Rep.', 'CF'], 613: ['Cameroon', 'CM'],
  615: ['Congo', 'CG'], 616: ['Comoros', 'KM'], 617: ['Cabo Verde', 'CV'],
  618: ['Crozet (FR)', 'TF'], 619: ['Ivory Coast', 'CI'], 620: ['Comoros', 'KM'],
  621: ['Djibouti', 'DJ'], 622: ['Egypt', 'EG'], 624: ['Ethiopia', 'ET'],
  625: ['Eritrea', 'ER'], 626: ['Gabon', 'GA'], 627: ['Ghana', 'GH'],
  629: ['Gambia', 'GM'], 630: ['Guinea-Bissau', 'GW'], 631: ['Eq. Guinea', 'GQ'],
  632: ['Guinea', 'GN'], 633: ['Burkina Faso', 'BF'], 634: ['Kenya', 'KE'],
  635: ['Kerguelen (FR)', 'TF'], 636: ['Liberia', 'LR'], 637: ['Liberia', 'LR'],
  638: ['South Sudan', 'SS'], 642: ['Libya', 'LY'], 644: ['Lesotho', 'LS'],
  645: ['Mauritius', 'MU'], 647: ['Madagascar', 'MG'], 649: ['Mali', 'ML'],
  650: ['Mozambique', 'MZ'], 654: ['Mauritania', 'MR'], 655: ['Malawi', 'MW'],
  656: ['Niger', 'NE'], 657: ['Nigeria', 'NG'], 659: ['Namibia', 'NA'],
  660: ['Réunion (FR)', 'RE'], 661: ['Rwanda', 'RW'], 662: ['Sudan', 'SD'],
  663: ['Senegal', 'SN'], 664: ['Seychelles', 'SC'], 665: ['St. Helena', 'SH'],
  666: ['Somalia', 'SO'], 667: ['Sierra Leone', 'SL'], 668: ['São Tomé', 'ST'],
  669: ['Eswatini', 'SZ'], 670: ['Chad', 'TD'], 671: ['Togo', 'TG'],
  672: ['Tunisia', 'TN'], 674: ['Tanzania', 'TZ'], 675: ['Uganda', 'UG'],
  676: ['DR Congo', 'CD'], 677: ['Tanzania', 'TZ'], 678: ['Zambia', 'ZM'],
  679: ['Zimbabwe', 'ZW'], 701: ['Argentina', 'AR'], 710: ['Brazil', 'BR'],
  720: ['Bolivia', 'BO'], 725: ['Chile', 'CL'], 730: ['Colombia', 'CO'],
  735: ['Ecuador', 'EC'], 740: ['Falkland Is.', 'FK'], 745: ['Guiana (FR)', 'GF'],
  750: ['Guyana', 'GY'], 755: ['Paraguay', 'PY'], 760: ['Peru', 'PE'],
  765: ['Suriname', 'SR'], 770: ['Uruguay', 'UY'], 775: ['Venezuela', 'VE'],
}

/** Flag state for an MMSI, or null when the prefix is unknown/non-ship. */
export function flagStateOf(mmsi: number): string | null {
  const mid = Math.floor(mmsi / 1_000_000)
  return MID_COUNTRIES[mid]?.[0] ?? null
}

const REGIONAL_INDICATOR_A = 0x1f1e6

/** Flag emoji for an MMSI (regional-indicator pair), or null when unknown. */
export function flagEmojiOf(mmsi: number): string | null {
  const entry = MID_COUNTRIES[Math.floor(mmsi / 1_000_000)]
  if (entry === undefined) return null
  const [, iso2] = entry
  return String.fromCodePoint(
    REGIONAL_INDICATOR_A + (iso2.charCodeAt(0) - 65),
    REGIONAL_INDICATOR_A + (iso2.charCodeAt(1) - 65),
  )
}
