import { Link } from 'react-router-dom';

export default function BrandLink() {
  return (
    <Link className="inline-flex items-center gap-3" to="/#top" aria-label="UNO Arena, beranda">
      <span className="relative flex h-9 w-9 items-center justify-center" aria-hidden="true">
        <span className="absolute h-7 w-5 -rotate-12 rounded-md border-2 border-white bg-[#4b8ff5]" />
        <span className="absolute h-7 w-5 rotate-12 rounded-md border-2 border-white bg-[#f05252]" />
      </span>
      <span className="text-lg font-extrabold tracking-tight text-white">
        UNO <span className="text-[#f05252]">ARENA</span>
      </span>
    </Link>
  );
}
