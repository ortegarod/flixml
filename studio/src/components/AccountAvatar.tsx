import { UserRound } from "lucide-react";

// One account picture, wherever an account is shown: the header, the accounts
// directory, the profile page. `avatar` is a media filename under the output dir,
// so it renders through /api/thumb like any other asset; without one the account
// falls back to the brand mark rather than an empty square.
interface AccountAvatarProps {
  avatar: string | null | undefined;
  name?: string;
  className?: string;
  iconClassName?: string;
}

export function AccountAvatar({ avatar, name, className = "", iconClassName = "h-1/2 w-1/2" }: AccountAvatarProps) {
  return (
    <span className={`inline-block shrink-0 overflow-hidden ${className}`}>
      {avatar ? (
        <img src={`/api/thumb/${avatar}`} alt={name ?? ""} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand to-brand-soft">
          <UserRound className={`${iconClassName} text-white`} aria-hidden />
        </span>
      )}
    </span>
  );
}
