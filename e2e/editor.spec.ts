import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function blank(page: Page, name = '테스트 무대') {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('(예시)');
  await page.getByRole('button', { name: '배치 목록', exact: true }).click();
  await page.getByLabel('새 배치 이름').fill(name);
  await page.getByRole('button', { name: '빈 무대로 만들기' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

async function exportData(page: Page) {
  await page.getByRole('button', { name: '출력·내보내기' }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
  const dl = await event;
  const path = await dl.path();
  const data = JSON.parse(await readFile(path!, 'utf8'));
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  return data;
}

test('5종 세트, 악기 파트, 복제·삭제, 예비 수량', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await blank(page);
  await page.locator('.add-fields').getByLabel('악기', { exact: true }).selectOption({ label: '바이올린' });
  await page.locator('.add-fields').getByLabel('파트', { exact: true }).selectOption({ label: '제2바이올린' });
  for (const name of ['보면대+의자2', '보면대+의자1', '보면대만', '의자만', '장의자']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: '무대에 추가', exact: true }).click();
  }
  await page.getByLabel('장의자 길이').fill('320');
  await page.getByRole('button', { name: '복제', exact: true }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('button', { name: '준비 수량', exact: true }).click();
  await expect(page.getByRole('complementary').getByTestId('total-stands')).toHaveText('3개');
  await expect(page.getByRole('complementary').getByTestId('total-chairs')).toHaveText('4개');
  await expect(page.getByRole('complementary').getByTestId('total-benches')).toHaveText('1개');
  await expect(page.getByRole('complementary').locator('.group-table')).toContainText('제2바이올린');
  await page.getByLabel('예비 보면대').fill('2');
  await expect(page.getByRole('complementary').getByTestId('total-stands')).toHaveText('5개');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.getByRole('complementary').getByTestId('total-stands')).toHaveText('3개');
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expect(page.getByRole('complementary').getByTestId('total-stands')).toHaveText('5개');
  const exported = await exportData(page);
  expect(exported.layout.data.items).toHaveLength(5);
  expect(exported.layout.data.items.every((i: { partId: string }) => i.partId === 'demo-vn2')).toBe(true);
  expect(exported.layout.data.items.at(-1).benchLength).toBe(320);
  expect(errors).toEqual([]);
});

test('위치·회전 저장 복원, 파일 가져오기', async ({ page }) => {
  await blank(page, '파일 복원 테스트');
  await page.getByRole('button', { name: '무대에 추가', exact: true }).click();
  await page.getByLabel('세트 X 위치').fill('450');
  await page.getByLabel('세트 Y 위치').fill('350');
  await page.getByLabel('회전 각도').fill('90');
  await page.getByRole('button', { name: '메모리에 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '메모리에 저장', exact: true })).toBeDisabled();
  const data = await exportData(page);
  expect(data.layout.data.items[0]).toMatchObject({ x: 450, y: 350, rotation: 90 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('(예시)');
  await page.locator('input[type=file]').setInputFiles({ name: 'layout.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('파일 복원 테스트');
  const restored = await exportData(page);
  expect(restored.layout.data.items[0]).toMatchObject({ x: 450, y: 350, rotation: 90 });
  expect(restored.layout.data.items[0].id).not.toBe(data.layout.data.items[0].id);
});

test('열람 권한과 저장 충돌 안내', async ({ page }) => {
  await blank(page, '충돌 테스트');
  await page.getByRole('button', { name: '무대에 추가', exact: true }).click();
  await page.evaluate(async () => {
    const repo = (window as unknown as { __demoRepo: { listLayouts(team: string): Promise<{id: string; name: string}[]>; simulateExternalSave(id: string): boolean } }).__demoRepo;
    const rows = await repo.listLayouts('demo-team');
    repo.simulateExternalSave(rows.find(r => r.name === '충돌 테스트')!.id);
  });
  await page.getByRole('button', { name: '메모리에 저장', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('다른 담당자가 먼저 저장');
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: '현재 내용으로 덮어쓰기' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('데모 권한').selectOption('viewer');
  await expect(page.getByRole('button', { name: '무대에 추가', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '메모리에 저장', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '배치 목록', exact: true }).click();
  await expect(page.getByLabel('새 배치 이름')).toHaveCount(0);
});

test('canvas 이동·줌과 출력 미리보기', async ({ page, isMobile }) => {
  await blank(page, '드래그 테스트');
  await page.getByRole('button', { name: '무대에 추가', exact: true }).click();
  const before = await exportData(page);
  const box = await page.getByTestId('stage').boundingBox();
  expect(box).not.toBeNull();
  // 새 세트는 현재 보이는 영역의 중앙에 놓인다.
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  if (isMobile) {
    // 모바일에서는 아래 속성 입력 후 스크롤되어 있을 수 있으므로 무대로 이동.
    await page.getByTestId('stage').scrollIntoViewIfNeeded();
  }
  const rect = await page.getByTestId('stage').boundingBox();
  const cx = rect!.x + rect!.width / 2;
  const cy = rect!.y + rect!.height / 2;
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 65 * i / 12, y: cy + 40 * i / 12 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(cx + 65, cy + 40, { steps: 12 });
    await page.mouse.up();
  }
  const after = await exportData(page);
  expect(after.layout.data.items[0].x).not.toBe(before.layout.data.items[0].x);
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await page.getByRole('button', { name: '전체 보기', exact: true }).click();
  const stable = await exportData(page);
  expect(stable.layout.data).toEqual(after.layout.data);
  await page.getByRole('button', { name: '출력·내보내기' }).click();
  await expect(page.locator('.output-preview canvas')).toHaveCount(1);
  const dlEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG 이미지' }).click();
  expect((await dlEvent).suggestedFilename()).toMatch(/\.png$/);
  await page.evaluate(() => { window.print = () => {}; });
  await page.getByRole('button', { name: '인쇄 / PDF 저장' }).click();
  await expect(page.locator('.print-sheet img')).toHaveAttribute('src', /^data:image\/png/);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.print-sheet')).toBeVisible();
  await expect(page.locator('.app-header')).toBeHidden();
});
