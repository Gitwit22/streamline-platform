import React from "react";
import { useNavigate } from "react-router-dom";

const Welcome = () => {
  const nav = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white p-6 text-center relative">

<img
  src="/logosmall.png"
  alt="StreamLine Logo"
  className="w-4 h-4 mb-4"
/>



      <h1 className=" join-instructions text-4xl font-bold mb-4">Welcome to StreamLine</h1>
      <p className="join-instructions text-lg mb-8">Stream Anywhere. Anytime</p>

      <button
        onClick={() => nav("/login")}
        className="bg-white text-black px-6 py-3 rounded-xl font-semibold hover:bg-gray-300 transition"
      >
        Login
      </button>
    </div>
  );
};

export default Welcome;
