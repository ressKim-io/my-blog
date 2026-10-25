"""Check the frozen review snapshot; expected to fail after intentional post edits."""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--protected', type=Path, help='Optional pre-work path-to-SHA256 snapshot')
    args = parser.parse_args()
    output = Path(__file__).resolve().parent
    repository = output.parent.parent
    manifest = json.loads((output / 'manifest.json').read_text())
    items = manifest['items']
    errors = []

    def require(condition, message):
        if not condition:
            errors.append(message)

    expected_series = {'api': 23, 'node': 19, 'network': 11, 'storage': 7, 'extension': 6, 'kernel': 5}
    slugs = [item['slug'] for item in items]
    sources = [item['source'] for item in items]
    reviews = [item['review'] for item in items]
    require(len(items) == manifest['expected_count'] == 71, 'Scope count differs from 71')
    require(len(set(slugs)) == len(set(sources)) == len(set(reviews)) == 71, 'Duplicate manifest identity')
    actual_sources = {str(path.relative_to(repository)) for path in repository.glob(manifest['scope'])}
    require(actual_sources == set(sources), 'Source inventory differs from manifest')
    actual_reviews = {str(path.relative_to(output)) for path in (output / 'posts').glob('*.md')}
    require(actual_reviews == set(reviews), 'Review inventory differs from manifest')
    series_counts = Counter(item['series'].removeprefix('k8s-theory-') for item in items)
    require(dict(series_counts) == expected_series, 'Series counts differ')
    for series, count in expected_series.items():
        orders = sorted(item['order'] for item in items if item['series'] == 'k8s-theory-' + series)
        require(orders == list(range(1, count + 1)), f'Series order differs: {series}')

    sections = [
        '독자와 중심 질문', '현재 전개', '원문 근거와 개선점', '권장 설명 순서',
        '연결 문장 예시', '유지할 내용과 조건', '편집 후 독자 확인',
    ]
    evidence_count = 0
    preserved_sources = 0
    for item in items:
        source = repository / item['source']
        review = output / item['review']
        if not source.is_file() or not review.is_file():
            errors.append(f'Missing source or review: {item["slug"]}')
            continue
        preserved = digest(source) == item['sha256']
        require(preserved, f'Source hash changed: {item["source"]}')
        preserved_sources += int(preserved)
        source_lines = source.read_text().splitlines()
        require(len(source_lines) == item['lines'], f'Source line count changed: {item["slug"]}')
        content = review.read_text()
        require(f'`{item["sha256"]}`' in content, f'Review hash missing: {review.name}')
        require('상태: 구조 검토 완료 / 본문 미수정' in content, f'Review status differs: {review.name}')
        require(f'](../../../{item["source"]})' in content, f'Source link differs: {review.name}')
        for section in sections:
            require(content.count('## ' + section + '\n') == 1, f'Missing/duplicate section {section}: {review.name}')
        expected_headings = [(str(n), line[3:]) for n, line in enumerate(source_lines, 1) if line.startswith('## ')]
        actual_headings = re.findall(r'^- L(\d+): (.+)$', content, re.M)
        require(actual_headings == expected_headings, f'Current structure differs: {review.name}')
        evidence = re.findall(r'^### L(\d+) [^\n]+\n\n> ([^\n]+)', content, re.M)
        require(len(evidence) >= 1, f'No source evidence: {review.name}')
        require(content.count('수정 방향: ') == len(evidence), f'Evidence/action count differs: {review.name}')
        for number, quote in evidence:
            line_number = int(number)
            require(1 <= line_number <= len(source_lines) and quote in source_lines[line_number - 1],
                    f'Evidence mismatch L{number}: {review.name}')
            evidence_count += 1
        for section, pattern, minimum in [
            ('권장 설명 순서', r'^\d+\. .+', 4),
            ('유지할 내용과 조건', r'^- .+', 2),
            ('편집 후 독자 확인', r'^- .+', 2),
        ]:
            match = re.search(r'^## ' + section + r'\n(.*?)(?=^## |\Z)', content, re.M | re.S)
            require(match is not None and len(re.findall(pattern, match.group(1), re.M)) >= minimum,
                    f'Incomplete {section}: {review.name}')
        bridge = re.search(r'^## 연결 문장 예시\n(.*?)(?=^## |\Z)', content, re.M | re.S)
        require(bridge is not None and len(bridge.group(1).strip().splitlines()) >= 4,
                f'Missing concrete transition: {review.name}')

    batches = json.loads((output / 'batches.json').read_text())
    assigned = [slug for batch in batches['batches'] for slug in batch['slugs']]
    require(len(assigned) == len(set(assigned)) == 71 and set(assigned) == set(slugs), 'Batch coverage differs')
    require(len({batch['id'] for batch in batches['batches']}) == len(batches['batches']), 'Duplicate batch id')
    require(all(1 <= len(batch['slugs']) <= 3 and batch['status'] == 'not_started' for batch in batches['batches']),
            'Batch size/status differs')
    require(batches['post_editing_started'] is False, 'Post editing status differs')
    index = (output / 'index.md').read_text()
    require(index.count('| 완료 | 미수정 |') == 71 and '구조 검토 71/71편. 본문 편집 0/71편' in index,
            'Index completion status differs')
    for item in items:
        require(index.count('](' + item['review'] + ')') == 1, f'Index entry differs: {item["slug"]}')

    local_link_count = 0
    markdown_files = list(output.rglob('*.md'))
    for path in markdown_files:
        content = path.read_text()
        require(not re.search(r'[ぁ-ゖァ-ヺ]|\b(?:TODO|TBD|FIXME)\b|추후 작성|미작성', content),
                f'Unexpected language/placeholder: {path.name}')
        for target in re.findall(r'\[[^\]\n]*\]\(([^\)\n]+)\)', content):
            target = target.strip().strip('<>')
            if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:', target) or target.startswith('#'):
                continue
            target = target.split('#', 1)[0]
            require((path.parent / target).resolve().exists(), f'Broken local link: {path.name} -> {target}')
            local_link_count += 1
    for path in output.rglob('*'):
        if not path.is_file():
            continue
        content = path.read_text()
        require(content.endswith('\n'), f'Missing final newline: {path.name}')
        require(not re.search(r'[ \t]+$', content, re.M), f'Trailing whitespace: {path.name}')

    protected_count = 0
    if args.protected:
        protected = json.loads(args.protected.read_text())
        for relative, sha in protected.items():
            path = repository / relative
            unchanged = path.is_file() and digest(path) == sha
            require(unchanged, f'Protected tracked file changed: {relative}')
            protected_count += int(unchanged)

    report = {
        'result': 'PASS' if not errors else 'FAIL',
        'source_posts': len(items), 'preserved_source_hashes': preserved_sources,
        'review_files': len(actual_reviews), 'source_evidence_locations': evidence_count,
        'series_counts': dict(series_counts), 'batches': len(batches['batches']),
        'batch_posts_unique': len(set(assigned)), 'markdown_files': len(markdown_files),
        'local_links_checked': local_link_count,
        'protected_tracked_files_unchanged': protected_count if args.protected else None,
        'errors': errors,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == '__main__':
    sys.exit(main())
