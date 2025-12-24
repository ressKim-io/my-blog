const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const SOURCE_DIR = '/Users/ress/my-file/my-blog/_posts';
const TARGET_DIR = '/Users/ress/my-file/blog-nextjs/src/content';

// 시리즈 순서 추출 (파일명에서)
function extractSeriesOrder(filename, seriesName) {
  // part1, part2 등에서 숫자 추출
  const match = filename.match(/part(\d+)/i);
  return match ? parseInt(match[1]) : 1;
}

// 시리즈 이름 정규화
function normalizeSeriesName(series) {
  if (!series) return null;

  // "game-server", "istio" 등으로 정규화
  const seriesMap = {
    'challenge-1-game-server': 'game-server',
    'wealist-migration': 'wealist-migration',
    'istio-service-mesh-guide': 'istio',
    'istio': 'istio',
  };

  return seriesMap[series] || series;
}

// 카테고리 추출 (첫 번째 것만)
function extractCategory(categories) {
  if (Array.isArray(categories)) {
    return categories[0];
  }
  return categories || 'uncategorized';
}

// 날짜 포맷 변환
function formatDate(date) {
  if (!date) return new Date().toISOString().split('T')[0];

  if (typeof date === 'string') {
    // "2025-10-17 10:00:00 +0900" -> "2025-10-17"
    return date.split(' ')[0];
  }

  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }

  return String(date).split(' ')[0];
}

// 제목에서 카테고리 태그 제거
function cleanTitle(title) {
  // "[K8s] Istio Part1" -> "Istio Part1"
  return title.replace(/^\[.*?\]\s*/, '');
}

// 이미지 경로 변환
function convertImagePaths(content) {
  // {{ site.baseurl }}/assets/images/ -> /images/
  return content
    .replace(/\{\{\s*site\.baseurl\s*\}\}\/assets\/images\//g, '/images/')
    .replace(/\/assets\/images\//g, '/images/');
}

// 파일 변환
function convertPost(sourcePath, filename) {
  const fileContent = fs.readFileSync(sourcePath, 'utf8');
  const { data, content } = matter(fileContent);

  // 새 front matter 생성
  const seriesName = normalizeSeriesName(data.series);
  const newData = {
    title: cleanTitle(data.title || filename),
    excerpt: data.excerpt || '',
    category: extractCategory(data.categories),
    tags: Array.isArray(data.tags) ? data.tags : (data.tags ? [data.tags] : []),
    date: formatDate(data.date),
  };

  // 시리즈 정보 추가
  if (seriesName) {
    newData.series = {
      name: seriesName,
      order: extractSeriesOrder(filename, seriesName),
    };
  }

  // 콘텐츠 변환
  const newContent = convertImagePaths(content);

  // 새 파일 생성
  const newFileContent = matter.stringify(newContent, newData);

  // 파일명에서 날짜 제거 (2025-10-17-xxx.md -> xxx.md)
  const newFilename = filename.replace(/^\d{4}-\d{2}-\d{2}-/, '');

  return { filename: newFilename, content: newFileContent, data: newData };
}

// 메인 실행
function migrate() {
  // 타겟 디렉토리 초기화 (기존 샘플 포스트 삭제)
  if (fs.existsSync(TARGET_DIR)) {
    fs.readdirSync(TARGET_DIR).forEach(file => {
      if (file.endsWith('.md')) {
        fs.unlinkSync(path.join(TARGET_DIR, file));
      }
    });
  } else {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  // 모든 카테고리 디렉토리 순회
  const categories = fs.readdirSync(SOURCE_DIR);
  let count = 0;

  categories.forEach(category => {
    const categoryPath = path.join(SOURCE_DIR, category);
    if (!fs.statSync(categoryPath).isDirectory()) return;

    const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.md'));

    files.forEach(file => {
      const sourcePath = path.join(categoryPath, file);
      const result = convertPost(sourcePath, file);

      const targetPath = path.join(TARGET_DIR, result.filename);
      fs.writeFileSync(targetPath, result.content);

      console.log(`✓ ${file} -> ${result.filename}`);
      if (result.data.series) {
        console.log(`  Series: ${result.data.series.name} #${result.data.series.order}`);
      }
      count++;
    });
  });

  console.log(`\n✅ 총 ${count}개 포스트 마이그레이션 완료!`);
}

migrate();
