# 스토어 API 키 발급 가이드

공식 API 전환([plan.md](plan.md))에 필요한 키 두 개를 발급하는 과정이다.
발급 후 GitHub Secrets에 등록하면 코드 수정 없이 해당 기능이 켜진다.

키 파일(.p8, JSON)은 절대 커밋하거나 채팅에 붙이지 않는다.

## 애플 — App Store Connect API 키

소요 5분. Admin 이상 권한 계정이 필요하다.

1. [App Store Connect](https://appstoreconnect.apple.com) 로그인.
2. **사용자 및 액세스** → 상단 **통합(Integrations)** 탭.
3. 왼쪽 **App Store Connect API** → **팀 키** 탭.
   처음이면 "액세스 요청" 버튼이 뜬다. 동의하고 진행한다.
4. **+ (키 생성)** → 이름 `landit-alerts` → 액세스 권한 **App Manager** → 생성.
5. 세 가지를 챙긴다.
   - **Issuer ID** — 키 목록 상단의 UUID.
   - **Key ID** — 생성된 키 행의 10자리 문자열.
   - **.p8 파일** — "API 키 다운로드" 클릭.

⚠️ .p8 다운로드는 **한 번만** 가능하다. 페이지를 벗어나면 다시 받을 수 없고,
잃어버리면 키를 폐기(Revoke)하고 새로 만들어야 한다.

Secrets 매핑.

| Secret            | 값                 |
| ----------------- | ------------------ |
| `ASC_ISSUER_ID`   | Issuer ID          |
| `ASC_KEY_ID`      | Key ID             |
| `ASC_PRIVATE_KEY` | .p8 파일 내용 전체 |

## 구글 — Play 서비스 계정

소요 15분. 두 콘솔을 오간다.
Google Cloud에서 로봇 계정을 만들고, Play Console에서 그 계정에 권한을 준다.

### 1부. Google Cloud — 서비스 계정 만들기

1. [Google Cloud Console](https://console.cloud.google.com) 로그인.
2. 상단 프로젝트 드롭다운 → **새 프로젝트** → 이름 `landit-alerts` → 만들기.
   결제 설정은 필요 없다.
3. **API 및 서비스 → 라이브러리** → "Google Play Android Developer API" 검색 → **사용(Enable)**.
   ⚠️ 빼먹기 가장 쉬운 단계다. 이걸 안 켜면 키가 있어도 모든 요청이 403으로 실패한다.
4. **IAM 및 관리자 → 서비스 계정** → **서비스 계정 만들기** → 이름 `landit-alerts`.
   역할 부여 단계는 건너뛴다(권한은 Play Console에서 준다).
5. 만든 계정 클릭 → **키** 탭 → **키 추가 → 새 키 만들기 → JSON** → 다운로드.
6. 계정의 **이메일**(`landit-alerts@프로젝트ID.iam.gserviceaccount.com`)을 복사해둔다.

### 2부. Play Console — 권한 부여

7. [Play Console](https://play.google.com/console) 로그인. 관리자 권한 계정이어야 한다.
8. **사용자 및 권한** → **새 사용자 초대**.
9. 이메일 칸에 6번에서 복사한 서비스 계정 이메일을 넣는다.
10. **앱 권한** 탭 → **앱 추가** → 랜딧 선택 → 권한 두 개 체크.
    - **앱 정보 보기 (읽기 전용)** — 리뷰·버전 조회용
    - **리뷰에 답장** — 답글 기능용
11. **사용자 초대** 클릭. 서비스 계정은 수락 절차 없이 바로 적용된다.
    간혹 API 반영에 몇 분에서 수 시간이 걸릴 수 있다.

Secrets 매핑.

| Secret                      | 값                  |
| --------------------------- | ------------------- |
| `PLAY_SERVICE_ACCOUNT_JSON` | JSON 파일 내용 전체 |

## Secrets 등록

레포 → Settings → Secrets and variables → Actions → New repository secret.
또는 gh CLI로.

```bash
gh secret set ASC_ISSUER_ID -R Aragornnnnnn/landit-alerts -b "발급받은 Issuer ID"
gh secret set ASC_KEY_ID -R Aragornnnnnn/landit-alerts -b "발급받은 Key ID"
gh secret set ASC_PRIVATE_KEY -R Aragornnnnnn/landit-alerts < AuthKey_XXXX.p8
gh secret set PLAY_SERVICE_ACCOUNT_JSON -R Aragornnnnnn/landit-alerts < service-account.json
```

등록이 끝나면 로컬의 .p8·JSON 파일은 안전한 곳(팀 비밀번호 관리자 등)에 보관하거나 삭제한다.
