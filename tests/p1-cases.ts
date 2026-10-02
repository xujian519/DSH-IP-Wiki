/**
 * The twenty first-phase questions and the cards that answer them.
 *
 * One home for the case list: the acceptance spec measures against it, and the
 * ranking diagnostic replays the same questions, so a question is reworded once
 * instead of being retyped — a retyped gold string silently turns a hit into a miss.
 * @module dsh-ip-wiki/tests/p1-cases
 */

/** One question, the scenario it belongs to, and the cards that answer it. */
export interface P1Case {
  /** The workflow the question belongs to. */
  readonly scenario: '撰写质检' | 'OA 答复'
  /** The question as the user asked it. */
  readonly question: string
  /**
   * Card file names, without `.md`, that answer the question.
   *
   * Four of these questions were answered by cards the nine landed merges replaced,
   * so the merged card comes first here: it is the canonical answer now, and the
   * superseded cards stay listed because they still carry the wording.
   */
  readonly wanted: readonly string[]
}

/** The twenty questions, with the card each one should reach. */
export const CASES: readonly P1Case[] = [
  { scenario: '撰写质检', question: '审查员说我把技术特征改得超出了原申请记载的范围，怎么判断这个边界？', wanted: ['merged-公知常识-34a74523', '如何判断技术特征的修改是否超出了专利申请的保护范围？-jfl95t', '如何判断技术特征的修改是否超出了专利申请的保护范围？-9335706f2e0'] },
  { scenario: '撰写质检', question: '权利要求书和说明书的撰写要求怎么系统性地规范化？', wanted: ['如何系统性地训练和规范化发明和实用新型专利申请文件中权利要求书与说-une3vr'] },
  { scenario: '撰写质检', question: '要求优先权时相同主题怎么认定？增加了技术特征还享有优先权吗？', wanted: ['专利申请中的优先权认定标准相同主题与增加技术特征以及新颖性宽限期的适用-6b2nsw'] },
  { scenario: '撰写质检', question: '从属权利要求和封闭式权利要求的撰写与认定标准是什么？', wanted: ['如何区分和判定专利侵权中涉及的封闭式权利要求、功能性特征以及从属专利-20e32eaf1a', '如何界定和判定专利侵权中涉及的封闭式权利要求、功能性特征以及从属专利-bnygej'] },
  { scenario: '撰写质检', question: '权利要求里写了功能性特征，撰写时要注意什么边界？', wanted: ['如何区分和判定专利侵权中涉及的封闭式权利要求、功能性特征以及从属专利-20e32eaf1a', '如何界定和判定专利侵权中涉及的封闭式权利要求、功能性特征以及从属专利-bnygej'] },
  { scenario: '撰写质检', question: '外观设计申请里哪些设计特征属于功能性设计特征、撰写时要不要写进去？', wanted: ['外观设计侵权认定中，如何区分和处理由产品功能决定的“功能性设计特征”-65e0158edd', '外观设计侵权认定中，如何区分和处理由产品功能决定的设计特征功能性设计-e0r4x'] },
  { scenario: '撰写质检', question: '化学领域申请，化合物和组合物的创造性怎么在说明书里体现？', wanted: ['化学领域发明化合物、组合物、方法、用途的创造性判断标准与关键要素是什么-410afb45f5'] },
  { scenario: '撰写质检', question: '申请文件里怎么写现有技术的公开方式，出版物公开和使用公开的时间点怎么定？', wanted: ['如何界定现有技术或现有设计中的‘出版物公开’和‘使用公开’的范围与时-mmn2st'] },
  { scenario: '撰写质检', question: '说明书写了解决技术难题、克服技术偏见，这些辅助因素要怎么写才站得住？', wanted: ['专利审查中，辅助判断因素如解决技术难题、克服技术偏见、取得预料不到的效-h22u2i', '如何通过辅助判断因素如解决技术难题、克服技术偏见、取得预料不到的效果来-sle76j'] },
  { scenario: '撰写质检', question: '撰写时怎么预置三步法的论证链条，方便后面答复创造性？', wanted: ['专利创造性判断的“三步法”框架及其核心要素是什么？-ag3qhh', '专利创造性判断的“三步法”框架是什么？-b5a91a34e3d'] },
  { scenario: 'OA 答复', question: '审查意见说权利要求不具备创造性，三步法具体怎么用？', wanted: ['专利创造性判断的“三步法”框架及其核心要素是什么？-ag3qhh', '专利创造性判断的“三步法”框架是什么？-b5a91a34e3d'] },
  { scenario: 'OA 答复', question: '审查员用一篇对比文件加公知常识否定创造性，我怎么答复？', wanted: ['merged-公知常识-6b296834', '如何运用‘单对比文件+公知常识’模式来否定权利要求创造性？-11v0pc', '如何运用‘单对比文件+公知常识’模式来否定权利要求的创造性？-193e7c2d874'] },
  { scenario: 'OA 答复', question: '我想主张预料不到的技术效果来支持创造性，审查员会怎么认？', wanted: ['专利审查中，辅助判断因素如解决技术难题、克服技术偏见、取得预料不到的效-h22u2i', '如何通过辅助判断因素如解决技术难题、克服技术偏见、取得预料不到的效果来-sle76j'] },
  { scenario: 'OA 答复', question: '化学领域的创造性答复要注意哪些关键要素？', wanted: ['化学领域发明化合物、组合物、方法、用途的创造性判断标准与关键要素是什么-410afb45f5'] },
  { scenario: 'OA 答复', question: '答复里想引修改超范围的法条，判断标准是什么？', wanted: ['merged-公知常识-34a74523', '如何判断技术特征的修改是否超出了专利申请的保护范围？-jfl95t', '如何判断技术特征的修改是否超出了专利申请的保护范围？-9335706f2e0', '专利申请文件修改的边界与超范围判断标准是什么？-kiwhnr'] },
  { scenario: 'OA 答复', question: '复审阶段想提无效宣告，请求人资格和理由分类有什么限制？', wanted: ['merged-专利无效-d1b3f174', '专利无效宣告程序的核心流程、理由分类、请求人资格限制及与侵权诉讼的衔接-tco21k', '专利无效宣告程序的核心流程、理由分类、请求人资格限制及与侵权诉讼的衔接-9b2e6dfe6b'] },
  { scenario: 'OA 答复', question: '无效宣告决定对之前的侵权判决有没有追溯力？', wanted: ['专利无效宣告对既有侵权判决的追溯力限制与程序衔接机制是什么？-o7e0tv'] },
  { scenario: 'OA 答复', question: '无效程序里争专利权效力：独占权的构成要件怎么界定实施行为？', wanted: ['专利权被授予后，专利权人享有的独占权排他权的构成要件与实施行为的界定-x4c6t8'] },
  { scenario: 'OA 答复', question: '答复和诉讼里抗辩时机怎么把握，形式无效和实质无效抗辩分别怎么提？', wanted: ['专利侵权抗辩中的抗辩时机、形式无效与实质无效抗辩的法律规定与实践要点-djeznj'] },
  { scenario: 'OA 答复', question: '侵权诉讼的举证责任怎么分配，什么情况下倒置？', wanted: ['专利侵权诉讼中的举证责任分配、倒置规则及商业秘密保护的法律框架-89mgmf'] },
]

/**
 * Whether a hit answers the question.
 * @param case_ - the question and its expected cards.
 * @param path - the hit's library-relative path.
 * @returns whether the path is one of the expected cards.
 */
export function answers(case_: P1Case, path: string): boolean {
  return case_.wanted.some(wanted => path.endsWith(`${wanted}.md`))
}
